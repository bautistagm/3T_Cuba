/**
 * Eliminar un sábado entero (solo el dueño). Si movió plata, pide decidir por los cobros a invitados y por la
 * cocina, así la caja sigue cerrando.
 */
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { fechaLarga, pesos } from "../plata";
import { mensajeDe } from "./comunes";

type Info = Awaited<ReturnType<typeof api.antesDeEliminarSabado>>;

export function EliminarSabado(props: { sabadoId: string; alCerrar: () => void; alEliminar: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [cobros, setCobros] = useState<"DEVUELTOS" | "QUEDAN" | null>(null);
  const [nombreCobros, setNombreCobros] = useState("");
  const [cocina, setCocina] = useState<"VOLVIO" | "SE_GASTO" | null>(null);
  const [nombreCocina, setNombreCocina] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    api.antesDeEliminarSabado(props.sabadoId).then(setInfo).catch((e: unknown) => setError(mensajeDe(e)));
  }, [props.sabadoId]);

  async function eliminar(evento: FormEvent) {
    evento.preventDefault();
    if (!info) return;
    setError(null);
    if (info.cobros > 0 && !cobros) return setError("Elegí qué pasó con lo cobrado a los invitados.");
    if (cobros === "QUEDAN" && nombreCobros.trim().length < 3) return setError("Poné un nombre para el ingreso.");
    if (info.cocinaConPlata && !cocina) return setError("Elegí qué pasó con la plata de la cocina.");
    if (cocina === "SE_GASTO" && nombreCocina.trim().length < 3) return setError("Poné un nombre para el gasto.");
    setBorrando(true);
    try {
      await api.eliminarSabado(props.sabadoId, {
        ...(info.cobros > 0 ? { cobros: cobros === "QUEDAN" ? { destino: "QUEDAN", concepto: nombreCobros.trim() } : { destino: "DEVUELTOS" } } : {}),
        ...(info.cocinaConPlata ? { cocina: cocina === "SE_GASTO" ? { destino: "SE_GASTO", concepto: nombreCocina.trim() } : { destino: "VOLVIO" } } : {}),
      });
      props.alEliminar();
    } catch (e) {
      setError(mensajeDe(e));
      setBorrando(false);
    }
  }

  const sinPlata = info && info.cobros === 0 && !info.cocinaConPlata;
  return (
    <div className="capa" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminar" onClick={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <form className="tarjeta ventana" onSubmit={eliminar}>
        <h2 id="titulo-eliminar">Eliminar {info ? `el sábado ${fechaLarga(info.fecha)}` : "el sábado"}</h2>
        {!info && !error && <div className="cargando" />}
        {sinPlata && <p>Se borra el sábado{info.tieneCocina ? " con su cocina" : ""}. No movió plata: la caja no cambia. <strong>No se puede deshacer.</strong></p>}

        {info && info.cobros > 0 && (
          <>
            <h3>Cobros a invitados</h3>
            <p className="aviso error">Se cobraron <strong>{pesos(info.cobrosCentavos)}</strong> ({info.cobros} {info.cobros === 1 ? "cobro" : "cobros"}). ¿Qué pasó con esa plata?</p>
            <label className="opcion">
              <input type="radio" name="cobros" checked={cobros === "DEVUELTOS"} onChange={() => setCobros("DEVUELTOS")} />
              <span><strong>Los devolví</strong><span className="ayuda">La plata sale de la caja.</span></span>
            </label>
            <label className="opcion">
              <input type="radio" name="cobros" checked={cobros === "QUEDAN"} onChange={() => setCobros("QUEDAN")} />
              <span><strong>Queda en la caja</strong><span className="ayuda">Pasa a ser otro ingreso, con el nombre que le pongas.</span></span>
            </label>
            {cobros === "QUEDAN" && (
              <label className="campo">¿Qué ingreso es?<input maxLength={120} value={nombreCobros} onChange={(e) => setNombreCobros(e.target.value)} placeholder="Ej: Prueba de la app" /></label>
            )}
          </>
        )}

        {info?.cocinaConPlata && (
          <>
            <h3>La cocina</h3>
            <p className="aviso error">
              La cocina le costó <strong>{pesos(info.cocinaGastadoCentavos)}</strong> a la caja
              {BigInt(info.enManosDeLaCamadaCentavos) > 0n ? <> (de eso, {pesos(info.enManosDeLaCamadaCentavos)} todavía los tiene la camada)</> : null}. ¿Qué pasó con esa plata?
            </p>
            <label className="opcion">
              <input type="radio" name="cocina" checked={cocina === "VOLVIO"} onChange={() => setCocina("VOLVIO")} />
              <span><strong>Volvió todo</strong><span className="ayuda">Como si ese sábado no hubiera existido: la plata vuelve a donde estaba.</span></span>
            </label>
            <label className="opcion">
              <input type="radio" name="cocina" checked={cocina === "SE_GASTO"} onChange={() => setCocina("SE_GASTO")} />
              <span><strong>Se gastó igual</strong><span className="ayuda">Queda como un solo gasto, con el nombre que le pongas.</span></span>
            </label>
            {cocina === "SE_GASTO" && (
              <label className="campo">¿En qué se gastó?<input maxLength={120} value={nombreCocina} onChange={(e) => setNombreCocina(e.target.value)} placeholder="Ej: Cocina de prueba" /></label>
            )}
          </>
        )}

        {info && !sinPlata && <p className="ayuda">Después se borran el sábado, la cocina, sus gastos y cobros. Los movimientos de la caja quedan registrados. No se puede deshacer.</p>}
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton peligro" type="submit" disabled={!info || borrando}>{borrando ? "Eliminando…" : "Eliminar sábado"}</button>
        <button className="boton secundario" type="button" onClick={props.alCerrar}>Cancelar</button>
      </form>
    </div>
  );
}
