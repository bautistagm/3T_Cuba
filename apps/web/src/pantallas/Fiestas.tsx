import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { formatearDni } from "@3t/shared";
import { api, type DetalleFiesta, type FiestaListada } from "../api";
import { Encabezado, mensajeDe, useAviso } from "../componentes/comunes";
import { leerMonto, pesos } from "../plata";
import { useAdmin } from "../sesion";

const fechaFiesta = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
const linkDeVenta = (token: string) => `${window.location.origin}/entradas/${token}`;

export function PantallaFiestas() {
  const yo = useAdmin();
  const [fiestas, setFiestas] = useState<FiestaListada[] | null>(null);
  const [creando, setCreando] = useState(false);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      setFiestas((await api.fiestas()).fiestas);
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }, [setAviso]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <>
      <Encabezado volverA="/" volverTexto="3T" titulo="Fiestas" />
      <main className="contenido">
        <Aviso />
        {yo.rol === "DUENO" && !creando && (
          <button type="button" className="boton principal" onClick={() => setCreando(true)}>+ Crear fiesta</button>
        )}
        {creando && (
          <FormFiesta
            alCancelar={() => setCreando(false)}
            alCrear={async (nombre) => {
              setCreando(false);
              setAviso({ tipo: "ok", texto: `${nombre} creada. Entrá para copiar los links de venta.` });
              await cargar();
            }}
          />
        )}
        {fiestas === null && <div className="cargando" aria-label="Cargando" />}
        {fiestas?.length === 0 && !creando && (
          <section className="tarjeta"><p className="ayuda">Todavía no hay fiestas. {yo.rol === "DUENO" ? "Creá la primera." : "Las crea el dueño."}</p></section>
        )}
        {fiestas && fiestas.length > 0 && (
          <section className="tarjeta">
            <ul className="lista">
              {fiestas.map((f) => (
                <li key={f.id}>
                  <Link to={`/fiestas/${f.id}`} className="datos enlace-fila">
                    <strong>{f.nombre}</strong>
                    <span>{fechaFiesta(f.fechaHora)} · {f.vendidas} vendidas{f.pendientes > 0 ? ` · ${f.pendientes} sin pagar` : ""}</span>
                  </Link>
                  <span className={`chip ${f.estado === "A_LA_VENTA" ? "azul" : "gris"}`}>{f.estado === "A_LA_VENTA" ? "A la venta" : "Cerrada"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function FormFiesta(props: { alCancelar: () => void; alCrear: (nombre: string) => Promise<void> }) {
  const [nombre, setNombre] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("23:00");
  const [lugar, setLugar] = useState("");
  const [tipos, setTipos] = useState([{ nombre: "Mujer", precio: "" }, { nombre: "Hombre", precio: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const precios = tipos.map((t) => ({ nombre: t.nombre, monto: leerMonto(t.precio) }));
    const malo = precios.find((p) => !p.monto.ok);
    if (malo && !malo.monto.ok) return setError(`Precio ${malo.nombre}: ${malo.monto.error}`);
    setGuardando(true);
    try {
      await api.crearFiesta({
        nombre,
        fechaHora: new Date(`${fecha}T${hora}:00-03:00`).toISOString(),
        ...(lugar.trim() ? { lugar } : {}),
        tipos: precios.map((p) => ({ nombre: p.nombre, precioCentavos: p.monto.ok ? p.monto.centavos : "0" })),
      });
      await props.alCrear(nombre);
    } catch (e) {
      setError(mensajeDe(e));
      setGuardando(false);
    }
  }

  return (
    <form className="tarjeta" onSubmit={enviar}>
      <h2>Nueva fiesta</h2>
      <label className="campo">Nombre o motivo<input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Fiesta de fin de año" /></label>
      <div className="fila-campos">
        <label className="campo">Día<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="campo">Hora<input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} /></label>
      </div>
      <label className="campo">Lugar (opcional)<input value={lugar} onChange={(e) => setLugar(e.target.value)} /></label>
      {tipos.map((t, i) => (
        <label className="campo" key={t.nombre}>
          Precio entrada {t.nombre}
          <input inputMode="decimal" required value={t.precio} placeholder="Ej: 15.000"
            onChange={(e) => setTipos(tipos.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))} />
        </label>
      ))}
      <p className="ayuda">Sin cupo: se venden todas las que se paguen. Cada tipo tiene su link de venta.</p>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Creando…" : "Crear fiesta"}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

const ESTADO_ENTRADA: Record<DetalleFiesta["entradas"][number]["estado"], { texto: string; chip: string }> = {
  VALIDA: { texto: "Pagada", chip: "azul" },
  USADA: { texto: "Ingresó", chip: "gris" },
  PENDIENTE_PAGO: { texto: "Sin pagar", chip: "naranja" },
  ANULADA: { texto: "Anulada", chip: "gris" },
};

export function PantallaFiesta() {
  const { id = "" } = useParams();
  const yo = useAdmin();
  const esDueno = yo.rol === "DUENO";
  const [d, setD] = useState<DetalleFiesta | null>(null);
  const [tipoVisto, setTipoVisto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      const r = await api.fiesta(id);
      setD(r);
      setTipoVisto((actual) => actual ?? r.tipos[0]?.id ?? null);
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }, [id, setAviso]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function hacer(accion: () => Promise<unknown>, texto: string) {
    try {
      await accion();
      setAviso({ tipo: "ok", texto });
      await cargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }

  function copiar(texto: string, clave: string) {
    void navigator.clipboard?.writeText(texto).then(() => setCopiado(clave)).catch(() => undefined);
  }

  if (!d) return (<><Encabezado volverA="/fiestas" volverTexto="Fiestas" titulo="Fiesta" /><main className="contenido"><Aviso /><div className="cargando" /></main></>);
  const lista = d.entradas.filter((e) => e.tipoId === tipoVisto);
  const contar = (tipoId: string) => d.entradas.filter((e) => e.tipoId === tipoId && (e.estado === "VALIDA" || e.estado === "USADA")).length;

  return (
    <>
      <Encabezado volverA="/fiestas" volverTexto="Fiestas" titulo={d.fiesta.nombre} />
      <main className="contenido">
        <Aviso />
        <section className="tarjeta">
          <p className="ayuda">{fechaFiesta(d.fiesta.fechaHora)}{d.fiesta.lugar ? ` · ${d.fiesta.lugar}` : ""}</p>
          <div className="numeros">
            {d.tipos.map((t) => (
              <span key={t.id}><span className="ayuda">{t.nombre} · {pesos(t.precioCentavos)}</span><strong>{contar(t.id)} vendidas</strong></span>
            ))}
            <span><span className="ayuda">Recaudado</span><strong>{pesos(d.recaudadoCentavos)}</strong></span>
          </div>
          {d.fiesta.estado === "VENTA_CERRADA" && <p className="aviso error">La venta está cerrada.</p>}
          {esDueno && !d.emailConfigurado && (
            <p className="aviso error">Los emails con las entradas todavía no salen: falta cargar la contraseña de aplicación de plantelcuba@gmail.com en Render. Mientras tanto, cada comprador ve sus QR en su página.</p>
          )}
          {esDueno && (
            <button type="button" className="boton secundario chico"
              onClick={() => window.confirm(d.fiesta.estado === "A_LA_VENTA" ? "¿Cerrar la venta? Los links dejan de vender." : "¿Volver a abrir la venta?") &&
                void hacer(() => api.ventaFiesta(d.fiesta.id, d.fiesta.estado !== "A_LA_VENTA"), d.fiesta.estado === "A_LA_VENTA" ? "Venta cerrada." : "Venta abierta.")}>
              {d.fiesta.estado === "A_LA_VENTA" ? "Cerrar la venta" : "Volver a abrir la venta"}
            </button>
          )}
        </section>

        <section className="tarjeta">
          <h2>Links de venta</h2>
          <p className="ayuda">Uno por tipo de entrada: mandá cada uno a quien corresponda.</p>
          {d.tipos.map((t) => {
            const link = linkDeVenta(t.tokenVenta);
            const mensaje = `Entradas ${t.nombre} para ${d.fiesta.nombre} (${fechaFiesta(d.fiesta.fechaHora)}): ${link}`;
            return (
              <div className="fila" key={t.id}>
                <span className="datos"><strong>{t.nombre}</strong><span className="link-corto">{link}</span></span>
                <span className="acciones-cuota">
                  <button type="button" className="boton secundario chico" onClick={() => copiar(link, t.id)}>{copiado === t.id ? "¡Copiado!" : "Copiar"}</button>
                  <a className="boton secundario chico" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                </span>
              </div>
            );
          })}
        </section>

        <section className="tarjeta">
          <div className="fila-titulo">
            <h2>Lista</h2>
            <a className="boton secundario chico" href={`/api/fiestas/${d.fiesta.id}/lista.csv`} download>Descargar</a>
          </div>
          <div className="segmentado" role="tablist" aria-label="Tipo de entrada">
            {d.tipos.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tipoVisto === t.id} className={tipoVisto === t.id ? "activo" : ""} onClick={() => setTipoVisto(t.id)}>
                {t.nombre} ({contar(t.id)})
              </button>
            ))}
          </div>
          {lista.length === 0 && <p className="ayuda">Todavía no hay entradas de este tipo.</p>}
          <ul className="lista">
            {lista.map((e) => (
              <li key={e.id}>
                <span className="datos">
                  <strong>{e.nombre}</strong>
                  <span>DNI {formatearDni(e.dni)}{e.usadaEn ? ` · entró ${fechaFiesta(e.usadaEn)}${e.usadaPor ? ` (${e.usadaPor})` : ""}` : ""}</span>
                  {(e.estado === "VALIDA" || e.estado === "USADA") && <EstadoEmail email={e.email} estado={d.emails[e.compraId]} />}
                </span>
                <span className="acciones-cuota">
                  <span className={`chip ${ESTADO_ENTRADA[e.estado].chip}`}>{ESTADO_ENTRADA[e.estado].texto}</span>
                  {esDueno && e.estado === "VALIDA" && (
                    <button type="button" className="enlace"
                      onClick={() => {
                        const otro = window.prompt(`Reenviar las entradas de esta compra. ¿A qué email? (dejalo así para mandarlas al mismo)`, e.email);
                        if (otro === null) return;
                        void hacer(() => api.reenviarEntradas(e.compraId, otro.trim() && otro.trim() !== e.email ? otro.trim() : undefined), "Email con las entradas en camino.");
                      }}>
                      reenviar
                    </button>
                  )}
                  {esDueno && e.estado === "PENDIENTE_PAGO" && (
                    <button type="button" className="enlace"
                      onClick={() => window.confirm(`¿Anular la compra de ${e.nombre}? (nunca se pagó)`) && void hacer(() => api.anularCompraEntradas(e.compraId), "Compra anulada.")}>
                      anular
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="ayuda">Las entradas pagadas por transferencia se acreditan solas. Si alguien pagó desde otra cuenta, aparece en Pagos → Revisar.</p>
        </section>
      </main>
    </>
  );
}

function EstadoEmail(props: { email: string; estado: DetalleFiesta["emails"][string] | undefined }) {
  const e = props.estado;
  if (!e) return <span>Email: {props.email}</span>;
  if (e.estado === "ENVIADA") return <span>✉️ Enviado a {props.email}</span>;
  if (e.estado === "PENDIENTE") return <span>✉️ Email pendiente a {props.email}{e.error ? ` (reintentando: ${e.error})` : ""}</span>;
  return <span className="texto-error">✉️ No se pudo mandar a {props.email}{e.error ? `: ${e.error}` : ""}</span>;
}
