import { useEffect, useState, type FormEvent } from "react";
import { api, type EstadoCuenta, type PruebaMercadoPago } from "../api";
import { mensajeDe } from "../componentes/comunes";
import { pesos } from "../plata";

const formatoFechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Prueba de conexión con Mercado Pago (solo el dueño). Lee y muestra; no guarda nada. */
export function PanelMercadoPago() {
  const [resultado, setResultado] = useState<PruebaMercadoPago | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);

  async function probar() {
    setProbando(true);
    setError(null);
    try {
      setResultado(await api.probarMercadoPago());
    } catch (e) {
      setResultado(null);
      setError(mensajeDe(e));
    } finally {
      setProbando(false);
    }
  }

  return (
    <section className="tarjeta" aria-labelledby="titulo-mp">
      <h2 id="titulo-mp">Mercado Pago</h2>
      <p className="ayuda">
        La app solo <strong>consulta</strong> tu cuenta: no puede mandar ni mover plata. Esta prueba muestra lo que te entró en los
        últimos 7 días y no guarda nada.
      </p>
      <FechaDeCorte />
      <button type="button" className="boton secundario" onClick={() => void probar()} disabled={probando}>
        {probando ? "Consultando…" : "Probar conexión"}
      </button>
      {error && <p className="aviso error" role="alert">{error}</p>}
      {resultado && (
        <div className="prueba-mp">
          <p className="aviso ok" role="status">
            Conectado a la cuenta {resultado.cuenta.apodo ?? resultado.cuenta.id}.{" "}
            {resultado.movimientos.length === 0
              ? "No hay entradas en los últimos 7 días."
              : resultado.movimientos.length === 1
                ? "Última entrada:"
                : `Últimas ${resultado.movimientos.length} entradas:`}
          </p>
          <ul className="lista">
            {resultado.movimientos.map((m) => (
              <li key={m.id} className="movimiento-mp">
                <div className="fila-mp">
                  <span>{m.fecha ? formatoFechaHora.format(new Date(m.fecha)) : "Sin fecha"}</span>
                  <strong>{pesos(m.montoCentavos)}</strong>
                </div>
                <small>
                  {[m.tipoOperacion, m.medio, m.estado].filter(Boolean).join(" · ")} · id {m.id}
                </small>
                {[...m.pagador, ...m.referencias].length > 0 && (
                  <details>
                    <summary>Datos que trae</summary>
                    <dl>
                      {[...m.pagador, ...m.referencias].map((d) => (
                        <div key={d.campo}>
                          <dt>{d.campo}</dt>
                          <dd>{d.valor}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Desde qué día la cuenta es solo del plantel: la app lee y reconoce transferencias desde ese día. */
function FechaDeCorte() {
  const [estado, setEstado] = useState<EstadoCuenta | null>(null);
  const [fecha, setFecha] = useState("");
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    api.estadoCuenta().then((e) => {
      setEstado(e);
      setFecha(e.fechaCorte ?? "");
    }).catch((e: unknown) => setError(mensajeDe(e)));
  }, []);

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (!window.confirm(`Desde el ${fecha.split("-").reverse().join("/")}, toda transferencia que entre a Mercado Pago se toma como del plantel. ¿Confirmás?`)) return;
    try {
      await api.fijarFechaCorte(fecha);
      setEstado(await api.estadoCuenta());
      setEditando(false);
      setOk("Fecha de corte guardada. La app ya lee la cuenta sola.");
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  if (!estado) return null;
  return (
    <div className="panel">
      <p className="ayuda">
        <strong>Fecha de corte:</strong>{" "}
        {estado.fechaCorte ? `desde el ${estado.fechaCorte.split("-").reverse().join("/")} la cuenta es solo del plantel.` : "todavía no está. Sin ella la app no lee la cuenta."}
        {estado.ultimaLectura && ` Última lectura: ${new Date(estado.ultimaLectura).toLocaleString("es-AR", { hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" })}.`}
      </p>
      {!editando && (
        <button type="button" className="boton secundario chico" onClick={() => setEditando(true)}>
          {estado.fechaCorte ? "Cambiar la fecha de corte" : "Fijar la fecha de corte"}
        </button>
      )}
      {editando && (
        <form onSubmit={guardar} className="botonera">
          <label className="campo">Desde qué día la cuenta es solo del plantel<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <button className="boton principal" type="submit">Guardar</button>
          <button className="boton secundario" type="button" onClick={() => setEditando(false)}>Cancelar</button>
        </form>
      )}
      {ok && <p className="aviso ok" role="status">{ok}</p>}
      {error && <p className="aviso error" role="alert">{error}</p>}
    </div>
  );
}
