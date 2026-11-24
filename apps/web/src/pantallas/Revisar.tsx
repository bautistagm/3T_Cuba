import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { formatearDni } from "@3t/shared";
import { api, type CompraPendiente, type CuotaJugador, type EstadoCuenta, type Jugador, type TransferenciaLeida, type TransferenciaParaRevisar } from "../api";
import { mensajeDe, useAviso } from "../componentes/comunes";
import { pesos } from "../plata";
import { useAdmin } from "../sesion";

const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires",
});
const fechaHora = (iso: string) => formatoFechaHora.format(new Date(iso));

function haceCuanto(iso: string | null): string {
  if (!iso) return "nunca";
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : fechaHora(iso);
}

const cuit = (c: string | null) => (c && c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

const RESOLUCION: Record<NonNullable<TransferenciaLeida["resolucion"]>, string> = {
  CUOTA_AUTO: "Reconocida sola",
  CUOTA_MANUAL: "Asignada a mano",
  YA_REGISTRADA: "Ya estaba cargada",
  OTRO_INGRESO: "Otro ingreso",
  NO_ES_DEL_PLANTEL: "No es del plantel",
};

export function PanelRevisar(props: { alCambiar: () => void }) {
  const yo = useAdmin();
  const esDueno = yo.rol === "DUENO";
  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [lista, setLista] = useState<TransferenciaParaRevisar[] | null>(null);
  const [ultimas, setUltimas] = useState<TransferenciaLeida[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const { setAviso, Aviso } = useAviso();
  const { alCambiar } = props;

  const cargar = useCallback(async () => {
    try {
      const [e, r, u] = await Promise.all([api.estadoCuenta(), api.transferenciasParaRevisar(), api.ultimasTransferencias()]);
      setEstado(e);
      setLista(r.transferencias);
      setUltimas(u.transferencias.filter((t) => t.estado !== "REVISAR"));
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }, [setAviso]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function leerAhora() {
    setLeyendo(true);
    try {
      const r = await api.leerCuentaAhora();
      if (r.estado === "SIN_CONFIGURAR") setAviso({ tipo: "error", texto: r.motivo ?? "Falta configurar la lectura de la cuenta." });
      else if (r.estado === "LEIDA") setAviso({ tipo: "ok", texto: r.nuevas ? `${r.nuevas} transferencias nuevas: ${r.confirmadas} reconocidas solas, ${r.paraRevisar} para revisar.` : "No hay transferencias nuevas." });
      else setAviso({ tipo: "ok", texto: "La cuenta se leyó hace un momento." });
      await cargar();
      alCambiar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    } finally {
      setLeyendo(false);
    }
  }

  async function resuelta(texto: string) {
    setAbierta(null);
    setAviso({ tipo: "ok", texto });
    await cargar();
    alCambiar();
  }

  const sinConfigurar = estado && (!estado.conectada || !estado.fechaCorte);
  return (
    <main className="contenido">
      <Aviso />
      <section className="tarjeta" aria-labelledby="titulo-revisar">
        <h2 id="titulo-revisar">Transferencias</h2>
        {estado && sinConfigurar && (
          <p className="aviso error">
            {!estado.conectada ? "La app todavía no está conectada a Mercado Pago." : "Falta la fecha de corte: desde qué día la cuenta es solo del plantel."}
            {esDueno && <> Se configura en <Link to="/ajustes">Ajustes</Link>.</>}
          </p>
        )}
        {estado && !sinConfigurar && (
          <p className="ayuda">
            La app lee tu cuenta sola y reconoce las cuotas por el DNI de quien transfiere. Última lectura: <strong>{haceCuanto(estado.ultimaLectura)}</strong>.
          </p>
        )}
        <button type="button" className="boton secundario" disabled={leyendo} onClick={() => void leerAhora()}>
          {leyendo ? "Leyendo la cuenta…" : "Leer la cuenta ahora"}
        </button>
      </section>

      <section className="tarjeta" aria-labelledby="titulo-dudosas">
        <h2 id="titulo-dudosas">¿De quién es esta transferencia?</h2>
        {lista === null && <div className="cargando" aria-label="Cargando" />}
        {lista?.length === 0 && <p className="aviso ok">No hay nada para revisar.</p>}
        {lista && lista.length > 0 && !esDueno && <p className="ayuda">Las resuelve el dueño.</p>}
        {lista && lista.length > 0 && (
          <ul className="lista lista-jugadores">
            {lista.map((t) => (
              <li key={t.mpPagoId}>
                <button type="button" className="fila-jugador" aria-expanded={abierta === t.mpPagoId} onClick={() => setAbierta(abierta === t.mpPagoId ? null : t.mpPagoId)}>
                  <span className="datos">
                    <strong>{pesos(t.montoCentavos)} · {fechaHora(t.fecha)}</strong>
                    <span>{t.motivo}</span>
                    <span>{t.dniPagador ? `CUIL ${cuit(t.cuitPagador)} (DNI ${formatearDni(t.dniPagador)})` : "Sin CUIL"} · operación {t.mpPagoId}</span>
                  </span>
                  <span aria-hidden="true" className="flecha">{abierta === t.mpPagoId ? "▴" : "▾"}</span>
                </button>
                {abierta === t.mpPagoId && esDueno && (
                  <ResolverTransferencia transferencia={t} alListo={resuelta} alFallar={(m) => setAviso({ tipo: "error", texto: m })} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {ultimas.length > 0 && (
        <section className="tarjeta" aria-labelledby="titulo-ultimas">
          <h2 id="titulo-ultimas">Últimas transferencias</h2>
          <ul className="lista">
            {ultimas.slice(0, 30).map((t) => (
              <li key={t.mpPagoId}>
                <span className="datos">
                  <strong>{t.jugador ?? t.nota ?? "—"}</strong>
                  <span>{fechaHora(t.fecha)} · {t.resolucion ? RESOLUCION[t.resolucion] : ""}</span>
                </span>
                <strong>{pesos(t.montoCentavos)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function pedirNota(pregunta: string): string | null {
  const nota = window.prompt(pregunta);
  if (nota === null) return null;
  if (nota.trim().length < 3) {
    window.alert("Escribí una nota un poco más larga.");
    return null;
  }
  return nota.trim();
}

function ResolverTransferencia(props: { transferencia: TransferenciaParaRevisar; alListo: (t: string) => Promise<void>; alFallar: (t: string) => void }) {
  const t = props.transferencia;
  const [buscar, setBuscar] = useState("");
  const [candidatos, setCandidatos] = useState<Jugador[]>([]);
  const [jugador, setJugador] = useState<{ id: string; nombre: string } | null>(t.jugadorSugerido);
  const [cuotas, setCuotas] = useState<CuotaJugador[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const alFallar = useRef(props.alFallar);
  alFallar.current = props.alFallar;

  useEffect(() => {
    if (jugador || buscar.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    const r = setTimeout(() => {
      api.jugadores({ estado: "TODOS", buscar }).then((x) => setCandidatos(x.jugadores.slice(0, 8))).catch(() => setCandidatos([]));
    }, 250);
    return () => clearTimeout(r);
  }, [buscar, jugador]);

  useEffect(() => {
    if (!jugador) {
      setCuotas(null);
      return;
    }
    api
      .cuotasJugador(jugador.id)
      .then((r) => {
        const pendientes = r.cuotas.filter((c) => c.estado === "PENDIENTE").reverse();
        setCuotas(pendientes);
        // Si alguna combinación de las más viejas suma justo, se marca sola.
        let suma = 0n;
        const marcadas = new Set<string>();
        for (const c of pendientes) {
          suma += BigInt(c.montoCentavos);
          marcadas.add(c.id);
          if (suma === BigInt(t.montoCentavos)) return setElegidas(marcadas);
          if (suma > BigInt(t.montoCentavos)) break;
        }
        setElegidas(new Set());
      })
      .catch((e: unknown) => alFallar.current(mensajeDe(e)));
  }, [jugador, t.montoCentavos]);

  const suma = (cuotas ?? []).filter((c) => elegidas.has(c.id)).reduce((s, c) => s + BigInt(c.montoCentavos), 0n);
  const cierra = suma === BigInt(t.montoCentavos);

  async function hacer(accion: () => Promise<unknown>, texto: string) {
    setEnviando(true);
    try {
      await accion();
      await props.alListo(texto);
    } catch (e) {
      props.alFallar(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <div className="panel">
      <h3 className="subtitulo">Es de un jugador</h3>
      {!jugador && (
        <>
          <input type="search" placeholder="Buscá al jugador" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar jugador" />
          {candidatos.map((c) => (
            <button key={c.id} type="button" className="boton secundario chico" onClick={() => setJugador({ id: c.id, nombre: `${c.nombre} ${c.apellido}` })}>
              {c.apellido}, {c.nombre}{c.camada ? ` · ${c.camada}` : ""}
            </button>
          ))}
        </>
      )}
      {jugador && (
        <>
          <p className="ayuda">
            <strong>{jugador.nombre}</strong> · <button type="button" className="enlace" onClick={() => { setJugador(null); setBuscar(""); }}>otro jugador</button>
          </p>
          {cuotas?.length === 0 && <p className="ayuda">No debe ninguna cuota.</p>}
          {cuotas?.map((c) => (
            <label key={c.id} className="opcion">
              <input type="checkbox" checked={elegidas.has(c.id)}
                onChange={(e) => {
                  const otra = new Set(elegidas);
                  if (e.target.checked) otra.add(c.id);
                  else otra.delete(c.id);
                  setElegidas(otra);
                }} />
              <span>{c.mes} · {pesos(c.montoCentavos)}</span>
            </label>
          ))}
          {cuotas && cuotas.length > 0 && !cierra && (
            <p className="ayuda">Las cuotas elegidas suman {pesos(suma)}; la transferencia es de {pesos(t.montoCentavos)}. Tienen que coincidir.</p>
          )}
          <button type="button" className="boton principal" disabled={!cierra || enviando}
            onClick={() => void hacer(() => api.asignarTransferencia(t.mpPagoId, jugador.id, [...elegidas]), `Asignada a ${jugador.nombre}.`)}>
            Asignar a {jugador.nombre}
          </button>
        </>
      )}
      <ComprasQueCoinciden transferencia={t} alListo={props.alListo} alFallar={props.alFallar} />
      <h3 className="subtitulo">O es otra cosa</h3>
      <button type="button" className="boton secundario chico" disabled={enviando}
        onClick={() => {
          const nota = pedirNota("¿Qué es? (por ejemplo: depósito del efectivo de Juan, o invitado del sábado). No se suma de nuevo a la caja.");
          if (nota) void hacer(() => api.transferenciaYaRegistrada(t.mpPagoId, nota), "Marcada como ya cargada.");
        }}>
        Ya está cargada en la app (depósito o invitado)
      </button>
      <button type="button" className="boton secundario chico" disabled={enviando}
        onClick={() => {
          const nota = pedirNota("¿De qué es este ingreso? (se suma a la caja como \"Otros ingresos\")");
          if (nota) void hacer(() => api.transferenciaOtroIngreso(t.mpPagoId, nota), "Cargada como otro ingreso.");
        }}>
        Otro ingreso del plantel
      </button>
      <button type="button" className="boton secundario chico" disabled={enviando}
        onClick={() => {
          const nota = pedirNota("¿De qué es? No entra a la caja: acordate de pasar esa plata a tu cuenta personal.");
          if (nota) void hacer(() => api.transferenciaNoEsDelPlantel(t.mpPagoId, nota), "Marcada como no del plantel. Pasá esa plata a tu cuenta personal.");
        }}>
        No es del plantel
      </button>
    </div>
  );
}

/** Compras de entradas sin pagar por el mismo total: el dueño elige cuál pagó esta transferencia. */
function ComprasQueCoinciden(props: { transferencia: TransferenciaParaRevisar; alListo: (t: string) => Promise<void>; alFallar: (t: string) => void }) {
  const [compras, setCompras] = useState<CompraPendiente[]>([]);
  const { mpPagoId } = props.transferencia;
  useEffect(() => {
    api.comprasParaTransferencia(mpPagoId).then((r) => setCompras(r.compras)).catch(() => setCompras([]));
  }, [mpPagoId]);
  if (compras.length === 0) return null;
  return (
    <>
      <h3 className="subtitulo">Es una compra de entradas</h3>
      {compras.map((c) => (
        <button key={c.id} type="button" className="boton secundario chico"
          onClick={() => {
            if (!window.confirm(`¿Esta transferencia paga la compra de ${c.quienCompra} (${c.cantidad} ${c.tipo}, ${c.fiesta})?`)) return;
            api.asignarTransferenciaACompra(mpPagoId, c.id)
              .then(() => props.alListo(`Entradas de ${c.quienCompra} pagadas.`))
              .catch((e: unknown) => props.alFallar(mensajeDe(e)));
          }}>
          {c.quienCompra} · {c.cantidad} {c.tipo} · {c.fiesta}
        </button>
      ))}
    </>
  );
}
