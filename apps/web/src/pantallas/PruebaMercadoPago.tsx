import { useState } from "react";
import { api, type PruebaMercadoPago } from "../api";
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
