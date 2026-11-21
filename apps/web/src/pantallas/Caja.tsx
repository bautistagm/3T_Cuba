import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, type EstadoCaja, type MovimientoCaja, type Traspaso } from "../api";
import { Cargando, Encabezado, mensajeDe, useAviso } from "../componentes/comunes";
import { EditorItems } from "../componentes/EditorItems";
import { leerMonto, pesos } from "../plata";
import { useAdmin } from "../sesion";
import { PanelAnalisis } from "./Analisis";
import { BotonFoto, RevisarTicket } from "./Cocina";

const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires",
});

export function PantallaCaja() {
  const [pestana, setPestana] = useState<"movimientos" | "analisis">("movimientos");
  return (
    <>
      <Encabezado volverA="/" volverTexto="3T" titulo="Caja" />
      <div className="contenido" style={{ paddingBottom: 0 }}>
        <div className="segmentado" role="tablist" aria-label="Secciones de caja">
          <button type="button" role="tab" aria-selected={pestana === "movimientos"} className={pestana === "movimientos" ? "activo" : ""} onClick={() => setPestana("movimientos")}>
            Plata y movimientos
          </button>
          <button type="button" role="tab" aria-selected={pestana === "analisis"} className={pestana === "analisis" ? "activo" : ""} onClick={() => setPestana("analisis")}>
            Análisis
          </button>
        </div>
      </div>
      {pestana === "movimientos" ? <PanelPlata /> : <PanelAnalisis />}
    </>
  );
}

function PanelPlata() {
  const yo = useAdmin();
  const [caja, setCaja] = useState<EstadoCaja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"depositar" | "entregar" | "gasto" | "control" | null>(null);
  const [desdeGasto, setDesdeGasto] = useState<"CUENTA" | "EFECTIVO">("CUENTA");
  const [recarga, setRecarga] = useState(0);
  const [revisando, setRevisando] = useState<string | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      setCaja(await api.caja());
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !caja) return <main className="contenido"><p className="aviso error" role="alert">{error}</p></main>;
  if (!caja) return <Cargando />;

  async function listo(texto: string) {
    setPanel(null);
    setRevisando(null);
    setAviso({ tipo: "ok", texto });
    setRecarga((r) => r + 1);
    await cargar();
  }
  const fallo = (e: unknown) => setAviso({ tipo: "error", texto: mensajeDe(e) });
  const miEfectivo = BigInt(caja.miEfectivoCentavos);
  const entrantes = caja.traspasosPendientes.filter((t) => t.paraAdminId === yo.id);
  const salientes = caja.traspasosPendientes.filter((t) => t.deAdminId === yo.id);

  return (
    <main className="contenido">
      <Aviso />

      <section className="tarjeta oscura" aria-label="Plata del plantel">
        <span className="ayuda-clara">Plata del plantel</span>
        <strong className="monto-grande">{pesos(caja.totalCentavos)}</strong>
        <ul className="lista clara">
          <li><span>En el alias (reserva)</span><strong>{pesos(caja.cuentaCentavos)}</strong></li>
          {caja.efectivo.map((e) => (
            <li key={e.adminId}><span>Efectivo a cargo de {e.adminId === yo.id ? "vos" : e.nombre}</span><strong>{pesos(e.centavos)}</strong></li>
          ))}
          {caja.camadas.map((c) => (
            <li key={c.cocinaId}>
              <Link to={`/cocinas/${c.cocinaId}`} className="link-claro">En manos de la camada {c.camada}</Link>
              <strong>{pesos(c.centavos)}</strong>
            </li>
          ))}
        </ul>
      </section>

      {entrantes.map((t) => (
        <TraspasoEntrante key={t.id} traspaso={t} alListo={listo} alFallar={fallo} />
      ))}
      {salientes.map((t) => (
        <section key={t.id} className="tarjeta">
          <p className="ayuda">Le entregaste {pesos(t.montoCentavos)} a {t.paraNombre}. Falta que lo confirme; mientras tanto sigue a tu cargo.</p>
          <button type="button" className="enlace" onClick={() => void api.rechazarTraspaso(t.id).then(() => listo("Entrega cancelada.")).catch(fallo)}>
            Cancelar la entrega
          </button>
        </section>
      ))}

      <section className="tarjeta" aria-labelledby="titulo-acciones">
        <h2 id="titulo-acciones">Tu efectivo: {pesos(miEfectivo)}</h2>
        {panel === null && (
          <div className="botonera">
            {miEfectivo > 0n && (
              <>
                <button type="button" className="boton secundario" onClick={() => setPanel("depositar")}>Lo deposité en el alias</button>
                <button type="button" className="boton secundario" onClick={() => setPanel("entregar")}>Se lo di a otro</button>
              </>
            )}
            <button type="button" className="boton principal" onClick={() => setPanel("gasto")}>Cargar un gasto</button>
            {yo.rol === "DUENO" && (
              <button type="button" className="boton secundario" onClick={() => setPanel("control")}>Controlar contra la reserva</button>
            )}
          </div>
        )}
        {panel === "depositar" && <FormMonto titulo="¿Cuánto depositaste?" maximo={miEfectivo} textoBoton="Registrar depósito"
          alEnviar={(m, nota) => api.depositar(m, nota).then(() => listo("Depósito registrado."))} alCancelar={() => setPanel(null)} />}
        {panel === "entregar" && <FormEntregar caja={caja} yoId={yo.id} maximo={miEfectivo} alListo={() => listo("Entrega registrada: falta que la confirme quien la recibe.")} alCancelar={() => setPanel(null)} />}
        {panel === "gasto" && (
          <div className="panel">
            <div className="segmentado" role="radiogroup" aria-label="De dónde salió la plata">
              {(["CUENTA", "EFECTIVO"] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={desdeGasto === d} className={desdeGasto === d ? "activo" : ""} onClick={() => setDesdeGasto(d)}>
                  {d === "CUENTA" ? "Del alias" : "De mi efectivo"}
                </button>
              ))}
            </div>
            <BotonFoto texto="Sacar foto del ticket"
              alSubir={async (b64) => {
                const r = await api.ticketCaja(desdeGasto, b64);
                await listo(r.estado === "REGISTRADO" ? "Ticket leído y registrado como gasto." : `El ticket quedó para revisar: ${r.motivoRevision ?? ""}`);
              }}
              alFallar={(m) => setAviso({ tipo: "error", texto: m })} />
            <p className="ayuda" style={{ textAlign: "center" }}>o cargalo a mano:</p>
            <EditorItems textoBoton="Guardar gasto"
              alGuardar={async (datos) => { await api.gastoCaja({ desde: desdeGasto, ...datos }); await listo("Gasto guardado."); }}
              alCancelar={() => setPanel(null)} />
          </div>
        )}
        {panel === "control" && <FormControl caja={caja} alListo={listo} alCancelar={() => setPanel(null)} />}
        {caja.ultimoControl && panel === null && (
          <p className="ayuda">
            Último control: {formatoFechaHora.format(new Date(caja.ultimoControl.creadoEn))} · diferencia {pesos(caja.ultimoControl.diferenciaCentavos)}
            {caja.ultimoControl.ajusteAsientoId ? " (ajustada)" : ""}
          </p>
        )}
      </section>

      {caja.ticketsParaRevisar.length > 0 && (
        <section className="tarjeta revisar" aria-labelledby="titulo-revisar-caja">
          <h2 id="titulo-revisar-caja">Tickets para revisar ({caja.ticketsParaRevisar.length})</h2>
          {caja.ticketsParaRevisar.map((t) =>
            revisando === t.id ? (
              <RevisarTicket key={t.id} ticket={t} alListo={listo} alCancelar={() => setRevisando(null)} alError={(m) => setAviso({ tipo: "error", texto: m })} />
            ) : (
              <div key={t.id} className="fila">
                <span className="datos"><span>{t.motivoRevision}</span></span>
                <button type="button" className="boton secundario chico" onClick={() => setRevisando(t.id)}>Revisar</button>
              </div>
            ),
          )}
        </section>
      )}

      <ListaMovimientos recarga={recarga} />
    </main>
  );
}

function TraspasoEntrante(props: { traspaso: Traspaso; alListo: (t: string) => Promise<void>; alFallar: (e: unknown) => void }) {
  const t = props.traspaso;
  return (
    <section className="tarjeta revisar" aria-label="Efectivo para confirmar">
      <strong>{t.deNombre} te entregó {pesos(t.montoCentavos)}</strong>
      {t.nota && <p className="ayuda">{t.nota}</p>}
      <p className="ayuda">Si lo confirmás, pasás a ser responsable de esa plata.</p>
      <button type="button" className="boton principal" onClick={() => void api.confirmarTraspaso(t.id).then(() => props.alListo("Listo: ahora esa plata está a tu cargo.")).catch(props.alFallar)}>
        Sí, lo recibí
      </button>
      <button type="button" className="boton secundario" onClick={() => void api.rechazarTraspaso(t.id).then(() => props.alListo("Marcado como no recibido.")).catch(props.alFallar)}>
        No lo recibí
      </button>
    </section>
  );
}

function FormMonto(props: { titulo: string; maximo?: bigint; textoBoton: string; alEnviar: (centavos: string, nota?: string) => Promise<void>; alCancelar: () => void }) {
  const [monto, setMonto] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const m = leerMonto(monto);
    if (!m.ok) return setError(m.error);
    if (props.maximo !== undefined && BigInt(m.centavos) > props.maximo) return setError(`Tenés ${pesos(props.maximo)} a tu cargo.`);
    try {
      await props.alEnviar(m.centavos, nota.trim() || undefined);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <form onSubmit={enviar} className="panel">
      <label className="campo">
        {props.titulo}
        <input inputMode="decimal" autoFocus required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 45.000" />
      </label>
      <label className="campo">
        Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit">{props.textoBoton}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

function FormEntregar(props: { caja: EstadoCaja; yoId: string; maximo: bigint; alListo: () => Promise<void>; alCancelar: () => void }) {
  const otros = props.caja.administradores.filter((a) => a.id !== props.yoId);
  const [para, setPara] = useState(otros[0]?.id ?? "");
  if (otros.length === 0) return <p className="aviso error">No hay otros administradores a quien entregarle.</p>;
  return (
    <div className="panel">
      <label className="campo">
        ¿A quién se lo diste?
        <select value={para} onChange={(e) => setPara(e.target.value)}>
          {otros.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </label>
      <FormMonto titulo="¿Cuánto?" maximo={props.maximo} textoBoton="Registrar entrega"
        alEnviar={(m, nota) => api.entregarEfectivo(para, m, nota).then(props.alListo)} alCancelar={props.alCancelar} />
    </div>
  );
}

function FormControl(props: { caja: EstadoCaja; alListo: (t: string) => Promise<void>; alCancelar: () => void }) {
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const leido = leerMonto(monto);
  const declarado = monto.trim() === "0" ? 0n : leido.ok ? BigInt(leido.centavos) : null;
  const diferencia = declarado === null ? null : declarado - BigInt(props.caja.cuentaCentavos);

  async function guardar(ajustar: boolean) {
    if (declarado === null) return setError("Escribí cuánto hay en la reserva.");
    try {
      await api.controlarCaja(declarado.toString(), ajustar, ajustar ? motivo : undefined);
      await props.alListo(ajustar ? "Control guardado y caja ajustada." : "Control guardado.");
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <div className="panel">
      <label className="campo">
        ¿Cuánto hay apartado en la reserva del plantel en Mercado Pago?
        <input inputMode="decimal" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 1.250.000" />
      </label>
      <p className="ayuda">Según la app debería haber {pesos(props.caja.cuentaCentavos)}.</p>
      {diferencia !== null && (
        diferencia === 0n
          ? <p className="aviso ok">Coincide exacto.</p>
          : <p className="aviso error">Hay una diferencia de {pesos(diferencia < 0n ? -diferencia : diferencia)} ({diferencia > 0n ? "sobra" : "falta"} en la reserva).</p>
      )}
      {diferencia !== null && diferencia !== 0n && (
        <label className="campo">
          Motivo del ajuste (si vas a ajustar)
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
      )}
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="button" onClick={() => void guardar(false)}>Guardar control</button>
      {diferencia !== null && diferencia !== 0n && (
        <button className="boton secundario" type="button" onClick={() => void guardar(true)}>Guardar y ajustar la caja</button>
      )}
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </div>
  );
}

function ListaMovimientos({ recarga }: { recarga: number }) {
  const [movimientos, setMovimientos] = useState<MovimientoCaja[] | null>(null);
  const [filtro, setFiltro] = useState<"TODO" | "ENTRADA" | "SALIDA" | "INTERNO">("TODO");
  const [hayMas, setHayMas] = useState(false);

  useEffect(() => {
    void api.movimientosCaja().then((r) => {
      setMovimientos(r.movimientos);
      setHayMas(r.movimientos.length === 50);
    });
  }, [recarga]);

  async function masViejos() {
    const ultimo = movimientos?.at(-1);
    if (!ultimo) return;
    const r = await api.movimientosCaja(ultimo.creadoEn);
    setMovimientos((m) => [...(m ?? []), ...r.movimientos]);
    setHayMas(r.movimientos.length === 50);
  }

  const visibles = (movimientos ?? []).filter((m) => filtro === "TODO" || m.tipo === filtro);
  const nombresFiltro = { TODO: "Todo", ENTRADA: "Entradas", SALIDA: "Salidas", INTERNO: "Pases" } as const;
  return (
    <section className="tarjeta" aria-labelledby="titulo-movs">
      <h2 id="titulo-movs">Movimientos</h2>
      <div className="chips" role="group" aria-label="Filtrar">
        {(Object.keys(nombresFiltro) as (keyof typeof nombresFiltro)[]).map((f) => (
          <button key={f} type="button" aria-pressed={filtro === f} className={filtro === f ? "chip-boton activo" : "chip-boton"} onClick={() => setFiltro(f)}>
            {nombresFiltro[f]}
          </button>
        ))}
      </div>
      {movimientos === null && <div className="cargando" aria-label="Cargando" />}
      {movimientos !== null && visibles.length === 0 && <p className="ayuda">No hay movimientos.</p>}
      <ul className="lista">
        {visibles.map((m) => (
          <li key={m.id} className={m.anulado ? "anulado" : ""}>
            <span className="datos">
              <strong>{m.descripcion}</strong>
              <span>{formatoFechaHora.format(new Date(m.creadoEn))} · {m.registradoPor}{m.categoria && m.tipo !== "INTERNO" ? ` · ${m.categoria}` : ""}{m.anulado ? " · ANULADO" : ""}</span>
            </span>
            <strong className={m.tipo === "ENTRADA" ? "texto-azul" : m.tipo === "SALIDA" ? "" : "texto-gris"}>
              {m.tipo === "ENTRADA" ? "+" : m.tipo === "SALIDA" ? "−" : "⇄ "}{pesos(m.montoCentavos)}
            </strong>
          </li>
        ))}
      </ul>
      {hayMas && <button type="button" className="boton secundario" onClick={() => void masViejos()}>Ver más viejos</button>}
    </section>
  );
}
