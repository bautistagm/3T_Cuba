/**
 * La X gris para eliminar una fiesta (solo el dueño). Si tiene plata cobrada, pide elegir qué pasó con esa plata,
 * así la caja sigue cerrando: se devolvió (sale de la caja) o queda en la caja como otro ingreso, con su nombre.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { pesos } from "../plata";
import { mensajeDe } from "./comunes";

export function BotonEliminar(props: { etiqueta: string; alTocar: () => void }) {
  return (
    <button type="button" className="boton-x" aria-label={props.etiqueta} title={props.etiqueta} onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.alTocar(); }}>×</button>
  );
}

export function EliminarFiesta(props: { fiestaId: string; alCerrar: () => void; alEliminar: (nombre: string) => void }) {
  const [info, setInfo] = useState<{ nombre: string; entradas: number; pagos: number; totalCentavos: string } | null>(null);
  const [destino, setDestino] = useState<"DEVUELTA" | "QUEDA" | null>(null);
  const [concepto, setConcepto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    api.antesDeEliminarFiesta(props.fiestaId).then(setInfo).catch((e: unknown) => setError(mensajeDe(e)));
  }, [props.fiestaId]);

  async function eliminar(evento: FormEvent) {
    evento.preventDefault();
    if (!info) return;
    setError(null);
    const conPlata = info.pagos > 0;
    if (conPlata && !destino) return setError("Elegí qué pasó con la plata.");
    if (destino === "QUEDA" && concepto.trim().length < 3) return setError("Poné de qué es el ingreso.");
    setBorrando(true);
    try {
      await api.eliminarFiesta(props.fiestaId, !conPlata ? undefined : destino === "QUEDA" ? { destino: "QUEDA", concepto: concepto.trim() } : { destino: "DEVUELTA" });
      props.alEliminar(info.nombre);
    } catch (e) {
      setError(mensajeDe(e));
      setBorrando(false);
    }
  }

  return (
    <div className="capa" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminar" onClick={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <form className="tarjeta ventana" onSubmit={eliminar}>
        <h2 id="titulo-eliminar">Eliminar {info ? `«${info.nombre}»` : "fiesta"}</h2>
        {!info && !error && <div className="cargando" />}
        {info && info.pagos === 0 && (
          <p>Se borra todo: la fiesta, sus links y {info.entradas === 0 ? "no tiene entradas" : `${info.entradas} ${info.entradas === 1 ? "entrada sin pagar" : "entradas sin pagar"}`}. No tiene plata cobrada, así que la caja no cambia. <strong>No se puede deshacer.</strong></p>
        )}
        {info && info.pagos > 0 && (
          <>
            <p className="aviso error">Esta fiesta tiene <strong>{pesos(info.totalCentavos)}</strong> cobrados ({info.pagos} {info.pagos === 1 ? "pago" : "pagos"}). Para que la caja cierre, decí qué pasó con esa plata:</p>
            <label className="opcion">
              <input type="radio" name="destino" checked={destino === "DEVUELTA"} onChange={() => setDestino("DEVUELTA")} />
              <span><strong>La devolví</strong><span className="ayuda">La plata sale de la caja.</span></span>
            </label>
            <label className="opcion">
              <input type="radio" name="destino" checked={destino === "QUEDA"} onChange={() => setDestino("QUEDA")} />
              <span><strong>Queda en la caja</strong><span className="ayuda">Pasa a ser otro ingreso, con el nombre que le pongas.</span></span>
            </label>
            {destino === "QUEDA" && (
              <label className="campo">
                ¿Qué ingreso es?
                <input autoFocus maxLength={120} value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Prueba de la app" />
              </label>
            )}
            <p className="ayuda">Después se borra la fiesta con sus entradas. Los movimientos de la caja quedan registrados. No se puede deshacer.</p>
          </>
        )}
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton peligro" type="submit" disabled={!info || borrando}>{borrando ? "Eliminando…" : "Eliminar fiesta"}</button>
        <button className="boton secundario" type="button" onClick={props.alCerrar}>Cancelar</button>
      </form>
    </div>
  );
}

export interface OpcionPlata {
  valor: string;
  titulo: string;
  ayuda: string;
  /** Si la opción pide un nombre (por ejemplo, el del ingreso o gasto nuevo). */
  pideNombre?: { etiqueta: string; ejemplo: string };
}

/**
 * Ventana genérica para eliminar algo que movió plata: muestra el monto y pide elegir qué pasó con esa plata,
 * así la caja cierra. Si no hay plata (montoCentavos null), solo pide confirmar.
 */
export function EliminarConPlata(props: {
  titulo: string;
  montoCentavos: string | null;
  sinPlata?: string;
  pregunta?: ReactNode;
  opciones: OpcionPlata[];
  boton: string;
  alCerrar: () => void;
  alConfirmar: (opcion: string | null, nombre: string) => Promise<void>;
}) {
  const [elegida, setElegida] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);
  const opcion = props.opciones.find((o) => o.valor === elegida);

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (props.montoCentavos !== null && !opcion) return setError("Elegí qué pasó con la plata.");
    if (opcion?.pideNombre && nombre.trim().length < 3) return setError(`Completá «${opcion.pideNombre.etiqueta}».`);
    setBorrando(true);
    try {
      await props.alConfirmar(opcion?.valor ?? null, nombre.trim());
    } catch (e) {
      setError(mensajeDe(e));
      setBorrando(false);
    }
  }

  return (
    <div className="capa" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminar" onClick={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <form className="tarjeta ventana" onSubmit={confirmar}>
        <h2 id="titulo-eliminar">{props.titulo}</h2>
        {props.montoCentavos === null ? (
          <p>{props.sinPlata ?? "No mueve plata: la caja no cambia."} <strong>No se puede deshacer.</strong></p>
        ) : (
          <>
            <p className="aviso error">{props.pregunta ?? <>Esto movió <strong>{pesos(props.montoCentavos)}</strong>. Para que la caja cierre, decí qué pasó con esa plata:</>}</p>
            {props.opciones.map((o) => (
              <label key={o.valor} className="opcion">
                <input type="radio" name="destino" checked={elegida === o.valor} onChange={() => setElegida(o.valor)} />
                <span><strong>{o.titulo}</strong><span className="ayuda">{o.ayuda}</span></span>
              </label>
            ))}
            {opcion?.pideNombre && (
              <label className="campo">
                {opcion.pideNombre.etiqueta}
                <input autoFocus maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={opcion.pideNombre.ejemplo} />
              </label>
            )}
            <p className="ayuda">Los movimientos de la caja quedan registrados. No se puede deshacer.</p>
          </>
        )}
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton peligro" type="submit" disabled={borrando}>{borrando ? "Eliminando…" : props.boton}</button>
        <button className="boton secundario" type="button" onClick={props.alCerrar}>Cancelar</button>
      </form>
    </div>
  );
}
