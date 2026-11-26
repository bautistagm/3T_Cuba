import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { enlaceWhatsApp } from "@3t/shared";
import { api, type CuotaJugador, type Deudor, type MesCuota } from "../api";
import { mensajeDe, pedirMotivo, useAviso } from "../componentes/comunes";
import { BotonEditar, BotonEliminar, EliminarConPlata, OPCIONES_COBRADO, plataDe } from "../componentes/EliminarFiesta";
import { EditarRapido } from "../componentes/EditarRapido";
import { leerMonto, montoParaEditar, pesos } from "../plata";
import { useAdmin } from "../sesion";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Mensaje de recordatorio para un jugador que debe. */
export function mensajeRecordatorio(d: Pick<Deudor, "nombre" | "cuotas" | "totalCentavos">, alias: string | null) {
  const meses = d.cuotas.map((c) => c.mes.toLowerCase()).join(" y ");
  const transferir = alias ? ` Podés transferir al alias ${alias} desde tu cuenta: se acredita sola.` : "";
  return `¡Hola ${d.nombre}! Te escribo del plantel por la cuota de ${meses} (${pesos(d.totalCentavos)}).${transferir} ¡Gracias!`;
}

export function PanelCuotas() {
  const yo = useAdmin();
  const esDueno = yo.rol === "DUENO";
  const [meses, setMeses] = useState<MesCuota[] | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"abrir" | "alias" | null>(null);
  const [abierto, setAbierto] = useState<string | "TODOS" | null>(null);
  const [editandoMes, setEditandoMes] = useState<MesCuota | null>(null);
  const [eliminandoMes, setEliminandoMes] = useState<{ mes: MesCuota; pagaron: number; cobradoCentavos: string; cuotas: number } | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      const r = await api.mesesCuota();
      setMeses(r.meses);
      setAlias(r.alias);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function listo(texto: string) {
    setPanel(null);
    setAviso({ tipo: "ok", texto });
    await cargar();
  }

  const totalFalta = meses?.reduce((t, m) => t + BigInt(m.faltaCentavos), 0n) ?? 0n;
  return (
    <main className="contenido">
      <Aviso />
      {error && <p className="aviso error" role="alert">{error}</p>}
      <section className="tarjeta" aria-labelledby="titulo-cuotas">
        <div className="fila-titulo">
          <h2 id="titulo-cuotas">Cuotas</h2>
          {meses && meses.length > 0 && <span className="ayuda">Falta cobrar {pesos(totalFalta)}</span>}
        </div>
        <p className="ayuda">
          Alias para transferir: <strong>{alias ?? "todavía no está cargado"}</strong>
          {esDueno && panel === null && (
            <> · <button type="button" className="enlace" onClick={() => setPanel("alias")}>{alias ? "cambiar" : "cargarlo"}</button></>
          )}
        </p>
        {panel === "alias" && <FormAlias actual={alias} alListo={listo} alCancelar={() => setPanel(null)} />}
        {esDueno && panel === null && (
          <button type="button" className="boton principal" onClick={() => setPanel("abrir")}>Abrir un mes</button>
        )}
        {panel === "abrir" && meses && <FormAbrirMes abiertos={meses} alListo={listo} alCancelar={() => setPanel(null)} />}
        {!esDueno && meses?.length === 0 && <p className="ayuda">Todavía no hay meses abiertos. Los abre el dueño.</p>}
      </section>

      {meses === null && !error && <div className="cargando" aria-label="Cargando" />}
      {meses && meses.length > 0 && (
        <section className="tarjeta" aria-label="Meses">
          <ul className="lista lista-meses">
            {meses.map((m) => (
              <li key={m.id}>
                <div className="fila-con-acciones">
                  <button type="button" className="fila-jugador" aria-expanded={abierto === m.id} onClick={() => setAbierto(abierto === m.id ? null : m.id)}>
                    <span className="datos">
                      <strong>{m.nombre} · {pesos(m.montoCentavos)}</strong>
                      <span>{m.pagaron} pagaron · {m.deben} deben{BigInt(m.faltaCentavos) > 0n ? ` · falta ${pesos(m.faltaCentavos)}` : ""}</span>
                    </span>
                    <span aria-hidden="true" className="flecha">{abierto === m.id ? "▴" : "▾"}</span>
                  </button>
                  {esDueno && (
                    <>
                      <BotonEditar etiqueta={`Editar ${m.nombre}`} alTocar={() => setEditandoMes(m)} />
                      <BotonEliminar etiqueta={`Eliminar ${m.nombre}`} alTocar={() => {
                        api.antesDeEliminarMes(m.id).then((i) => setEliminandoMes({ mes: m, ...i })).catch((e: unknown) => setAviso({ tipo: "error", texto: mensajeDe(e) }));
                      }} />
                    </>
                  )}
                </div>
                {abierto === m.id && (
                  <>
                    <ListaDeudores periodoId={m.id} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {editandoMes && <EditarMes mes={editandoMes} alCerrar={() => setEditandoMes(null)} alListo={async (t) => { setEditandoMes(null); await listo(t); }} />}
      {eliminandoMes && (
        <EliminarConPlata
          titulo={`Eliminar ${eliminandoMes.mes.nombre}`}
          montoCentavos={eliminandoMes.pagaron === 0 ? null : eliminandoMes.cobradoCentavos}
          sinPlata={`Se borran las ${eliminandoMes.cuotas} cuotas de ${eliminandoMes.mes.nombre}. Nadie pagó todavía: la caja no cambia.`}
          pregunta={<>{eliminandoMes.pagaron} {eliminandoMes.pagaron === 1 ? "jugador ya pagó" : "jugadores ya pagaron"} este mes: <strong>{pesos(eliminandoMes.cobradoCentavos)}</strong>. Si un pago cubría también otros meses, esos siguen pagados. ¿Qué pasó con la plata de este mes?</>}
          opciones={[
            { valor: "DEVUELTA", titulo: "La devolví", ayuda: "La plata sale de la caja." },
            { valor: "QUEDA", titulo: "Queda en la caja", ayuda: "Pasa a ser otro ingreso, con el nombre que le pongas.", pideNombre: { etiqueta: "¿Qué ingreso es?", ejemplo: "Ej: Prueba de la app" } },
          ]}
          boton="Eliminar mes"
          alCerrar={() => setEliminandoMes(null)}
          alConfirmar={async (opcion, nombre) => {
            await api.eliminarMes(eliminandoMes.mes.id, opcion === null ? undefined : opcion === "QUEDA" ? { destino: "QUEDA", concepto: nombre } : { destino: "DEVUELTA" });
            setEliminandoMes(null);
            await listo(`${eliminandoMes.mes.nombre} eliminado.`);
          }}
        />
      )}
      {meses && meses.length > 1 && (
        <section className="tarjeta" aria-labelledby="titulo-todos">
          <button type="button" className="fila-jugador" aria-expanded={abierto === "TODOS"} onClick={() => setAbierto(abierto === "TODOS" ? null : "TODOS")}>
            <span className="datos"><strong id="titulo-todos">Todos los que deben</strong><span>De todos los meses juntos</span></span>
            <span aria-hidden="true" className="flecha">{abierto === "TODOS" ? "▴" : "▾"}</span>
          </button>
          {abierto === "TODOS" && <ListaDeudores />}
        </section>
      )}
    </main>
  );
}

function FormAlias(props: { actual: string | null; alListo: (t: string) => Promise<void>; alCancelar: () => void }) {
  const [alias, setAlias] = useState(props.actual ?? "");
  const [error, setError] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    try {
      await api.fijarAlias(alias);
      await props.alListo("Alias guardado.");
    } catch (err) {
      setError(mensajeDe(err));
    }
  }
  return (
    <form className="panel" onSubmit={enviar}>
      <label className="campo">Alias de Mercado Pago del plantel<input required autoComplete="off" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Ej: plantel.cuba.3t" /></label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit">Guardar</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

function FormAbrirMes(props: { abiertos: MesCuota[]; alListo: (t: string) => Promise<void>; alCancelar: () => void }) {
  // Opciones: desde el mes actual hasta 12 meses adelante, salteando los ya abiertos.
  const hoy = new Date();
  const opciones: { anio: number; mes: number }[] = [];
  for (let i = -1; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;
    if (anio >= 2026 && !props.abiertos.some((a) => a.anio === anio && a.mes === mes)) opciones.push({ anio, mes });
  }
  const [elegido, setElegido] = useState(opciones[1] ? `${opciones[1].anio}-${opciones[1].mes}` : opciones[0] ? `${opciones[0].anio}-${opciones[0].mes}` : "");
  const [monto, setMonto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const m = leerMonto(monto);
    if (!m.ok) return setError(m.error);
    const [anio, mes] = elegido.split("-").map(Number);
    if (!anio || !mes) return setError("Elegí el mes.");
    if (!window.confirm(`¿Abrir ${MESES[mes - 1]} ${anio} con una cuota de ${pesos(m.centavos)}? Se le carga a todos los jugadores activos.`)) return;
    setGuardando(true);
    try {
      const r = await api.abrirMes({ anio, mes, montoCentavos: m.centavos });
      await props.alListo(`${MESES[mes - 1]} ${anio} abierto: se cargó la cuota a ${r.cuotasCargadas} jugadores.`);
    } catch (err) {
      setError(mensajeDe(err));
      setGuardando(false);
    }
  }
  if (opciones.length === 0) return <p className="aviso error">Ya están abiertos todos los meses del próximo año.</p>;
  return (
    <form className="panel" onSubmit={enviar}>
      <label className="campo">
        Mes
        <select value={elegido} onChange={(e) => setElegido(e.target.value)}>
          {opciones.map((o) => <option key={`${o.anio}-${o.mes}`} value={`${o.anio}-${o.mes}`}>{MESES[o.mes - 1]} {o.anio}</option>)}
        </select>
      </label>
      <label className="campo">Cuota de ese mes<input inputMode="decimal" required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 30.000" /></label>
      <p className="ayuda">Al abrirlo, se le carga la cuota a todos los jugadores activos. El monto se puede corregir mientras nadie haya pagado.</p>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Abriendo…" : "Abrir mes"}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

function EditarMes(props: { mes: MesCuota; alCerrar: () => void; alListo: (t: string) => Promise<void> }) {
  const [monto, setMonto] = useState(montoParaEditar(props.mes.montoCentavos));
  const [nota, setNota] = useState(props.mes.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    const m = leerMonto(monto);
    if (!m.ok) return setError(m.error);
    setGuardando(true);
    try {
      const r = await api.editarMes(props.mes.id, { montoCentavos: m.centavos, ...(nota.trim() ? { nota: nota.trim() } : {}) });
      await props.alListo(`${props.mes.nombre}: ${pesos(m.centavos)}${r.cuotasCambiadas ? ` (${r.cuotasCambiadas} cuotas pendientes actualizadas)` : ""}.`);
    } catch (x) {
      setError(mensajeDe(x));
      setGuardando(false);
    }
  }
  return (
    <div className="capa" role="dialog" aria-modal="true" aria-labelledby="titulo-editar-mes" onClick={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <form className="tarjeta ventana" onSubmit={guardar}>
        <h2 id="titulo-editar-mes">Editar {props.mes.nombre}</h2>
        <label className="campo">Monto de la cuota<input inputMode="decimal" required value={monto} onChange={(e) => setMonto(e.target.value)} /></label>
        <label className="campo">Nota (opcional)<input maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        {props.mes.pagaron > 0 && <p className="ayuda">{props.mes.pagaron} ya pagaron: a ellos no les cambia. El monto nuevo vale para los que todavía deben.</p>}
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        <button className="boton secundario" type="button" onClick={props.alCerrar}>Cancelar</button>
      </form>
    </div>
  );
}

function ListaDeudores(props: { periodoId?: string }) {
  const [datos, setDatos] = useState<{ deudores: Deudor[]; totalCentavos: string; alias: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.deudores(props.periodoId).then(setDatos).catch((e: unknown) => setError(mensajeDe(e)));
  }, [props.periodoId]);
  if (error) return <p className="aviso error" role="alert">{error}</p>;
  if (!datos) return <div className="cargando" aria-label="Cargando" />;
  if (datos.deudores.length === 0) return <p className="aviso ok">Pagaron todos. 🎉</p>;
  return (
    <div className="panel">
      <p className="ayuda">{datos.deudores.length} {datos.deudores.length === 1 ? "jugador debe" : "jugadores deben"} {pesos(datos.totalCentavos)}. Para cobrar en efectivo, buscá al jugador en la pestaña Jugadores.</p>
      <ul className="lista">
        {datos.deudores.map((d) => {
          const enlace = enlaceWhatsApp(d.telefono, mensajeRecordatorio(d, datos.alias));
          return (
            <li key={d.jugadorId}>
              <span className="datos">
                <strong>{d.apellido}, {d.nombre}</strong>
                <span>{d.cuotas.map((c) => c.mes).join(" + ")} · {pesos(d.totalCentavos)}</span>
              </span>
              {enlace ? (
                <a className="boton secundario chico" href={enlace} target="_blank" rel="noreferrer">WhatsApp</a>
              ) : (
                <span className="ayuda">Sin celular</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Las cuotas en la ficha de un jugador
// ---------------------------------------------------------------------------

const ESTADO: Record<CuotaJugador["estado"], { texto: string; chip: string }> = {
  PENDIENTE: { texto: "Debe", chip: "naranja" },
  PAGADO: { texto: "Pagada", chip: "azul" },
  ANULADO: { texto: "Anulada", chip: "gris" },
};

export function CuotasDelJugador(props: { jugadorId: string; nombre: string; activo: boolean; esDueno: boolean; alCambiar: (t: string) => void; alFallar: (t: string) => void }) {
  const [datos, setDatos] = useState<{ cuotas: CuotaJugador[]; mesesSinCuota: { periodoId: string; mes: string; montoCentavos: string }[] } | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [cobrando, setCobrando] = useState(false);
  const [editandoCuota, setEditandoCuota] = useState<CuotaJugador | null>(null);
  const [eliminandoCuota, setEliminandoCuota] = useState<CuotaJugador | null>(null);
  const alFallar = useRef(props.alFallar);
  alFallar.current = props.alFallar;
  const { jugadorId } = props;

  const cargar = useCallback(async () => {
    try {
      const r = await api.cuotasJugador(jugadorId);
      setDatos(r);
      // Por defecto, la cuota pendiente más vieja.
      const pendientes = r.cuotas.filter((c) => c.estado === "PENDIENTE");
      const masVieja = pendientes[pendientes.length - 1];
      setElegidas(masVieja ? new Set([masVieja.id]) : new Set());
    } catch (e) {
      alFallar.current(mensajeDe(e));
    }
  }, [jugadorId]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos) return <div className="cargando" aria-label="Cargando" />;
  const pendientes = datos.cuotas.filter((c) => c.estado === "PENDIENTE");
  const total = pendientes.filter((c) => elegidas.has(c.id)).reduce((t, c) => t + BigInt(c.montoCentavos), 0n);

  async function hacer(accion: () => Promise<unknown>, texto: string) {
    try {
      await accion();
      props.alCambiar(texto);
      await cargar();
    } catch (e) {
      props.alFallar(mensajeDe(e));
    }
  }

  return (
    <div className="cuotas-jugador">
      {editandoCuota && (
        <EditarRapido
          titulo={`Cuota de ${editandoCuota.mes}`}
          campos={[{ clave: "monto", etiqueta: "Monto", tipo: "monto", valor: montoParaEditar(editandoCuota.montoCentavos) }]}
          ayuda={`Solo para ${props.nombre}.`}
          alCerrar={() => setEditandoCuota(null)}
          alGuardar={async (v) => {
            await api.editarCuota(editandoCuota.id, v.monto ?? "0");
            setEditandoCuota(null);
            props.alCambiar(`Cuota de ${editandoCuota.mes} corregida.`);
            await cargar();
          }}
        />
      )}
      {eliminandoCuota && (
        <EliminarConPlata
          titulo={`Eliminar la cuota de ${eliminandoCuota.mes}`}
          montoCentavos={eliminandoCuota.estado === "PAGADO" ? eliminandoCuota.montoCentavos : null}
          sinPlata={`Se borra la cuota de ${eliminandoCuota.mes} de ${props.nombre}. No estaba pagada: la caja no cambia.`}
          pregunta={<>{props.nombre} ya pagó <strong>{pesos(eliminandoCuota.montoCentavos)}</strong> de esta cuota. Si ese pago cubría otros meses, siguen pagados. ¿Qué pasó con esta plata?</>}
          opciones={OPCIONES_COBRADO}
          boton="Eliminar cuota"
          alCerrar={() => setEliminandoCuota(null)}
          alConfirmar={async (opcion, nombre) => {
            await api.eliminarCuota(eliminandoCuota.id, plataDe(opcion, nombre));
            setEliminandoCuota(null);
            props.alCambiar(`Cuota de ${eliminandoCuota.mes} eliminada.`);
            await cargar();
          }}
        />
      )}
      <h3>Cuotas</h3>
      {datos.cuotas.length === 0 && <p className="ayuda">No tiene cuotas cargadas.</p>}
      <ul className="lista">
        {datos.cuotas.map((c) => (
          <li key={c.id}>
            {c.estado === "PENDIENTE" ? (
              <label className="opcion">
                <input type="checkbox" checked={elegidas.has(c.id)}
                  onChange={(e) => {
                    const otra = new Set(elegidas);
                    if (e.target.checked) otra.add(c.id);
                    else otra.delete(c.id);
                    setElegidas(otra);
                  }} />
                <span>{c.mes} · {pesos(c.montoCentavos)}</span>
              </label>
            ) : (
              <span className="datos"><span>{c.mes} · {pesos(c.montoCentavos)}</span>{c.motivoAnulacion && <span>{c.motivoAnulacion}</span>}</span>
            )}
            <span className="acciones-cuota">
              <span className={`chip ${ESTADO[c.estado].chip}`}>{ESTADO[c.estado].texto}</span>
              {props.esDueno && (
                <span className="iconos">
                  {c.estado === "PENDIENTE" && <BotonEditar etiqueta={`Editar la cuota de ${c.mes}`} alTocar={() => setEditandoCuota(c)} />}
                  <BotonEliminar etiqueta={`Eliminar la cuota de ${c.mes}`} alTocar={() => setEliminandoCuota(c)} />
                </span>
              )}
              {props.esDueno && c.estado === "PAGADO" && c.pagoId && (
                <button type="button" className="enlace" onClick={() => {
                  const motivo = pedirMotivo(`el pago de ${c.mes} (la cuota vuelve a quedar pendiente)`);
                  if (motivo && c.pagoId) void hacer(() => api.anularPago(c.pagoId as string, motivo), "Pago anulado: la cuota volvió a quedar pendiente.");
                }}>anular pago</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {pendientes.length > 0 && (
        <button type="button" className="boton principal" disabled={cobrando || elegidas.size === 0}
          onClick={() => {
            if (!window.confirm(`¿Cobraste ${pesos(total)} en efectivo a ${props.nombre}? La plata queda a tu cargo.`)) return;
            setCobrando(true);
            void hacer(() => api.cobrarEfectivo(props.jugadorId, [...elegidas]), `Cobro de ${pesos(total)} registrado.`).finally(() => setCobrando(false));
          }}>
          {elegidas.size === 0 ? "Elegí qué cuotas cobrás" : `Cobrar ${pesos(total)} en efectivo`}
        </button>
      )}
      {props.esDueno && props.activo && datos.mesesSinCuota.length > 0 && (
        <div className="botonera">
          {datos.mesesSinCuota.map((m) => (
            <button key={m.periodoId} type="button" className="boton secundario chico"
              onClick={() => window.confirm(`¿Agregarle a ${props.nombre} la cuota de ${m.mes} (${pesos(m.montoCentavos)})?`) && void hacer(() => api.agregarCuota(props.jugadorId, m.periodoId), `Se le agregó la cuota de ${m.mes}.`)}>
              + Agregarle la cuota de {m.mes}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
