/** Ventanita genérica del lápiz: unos pocos campos para corregir (montos, nombres, etc.). */
import { useState, type FormEvent, type ReactNode } from "react";
import { leerMonto } from "../plata";
import { mensajeDe } from "./comunes";

export type Campo =
  | { clave: string; etiqueta: string; tipo: "texto"; valor: string; requerido?: boolean; max?: number; formato?: "date" | "time" }
  | { clave: string; etiqueta: string; tipo: "monto"; valor: string }
  | { clave: string; etiqueta: string; tipo: "opciones"; valor: string; opciones: { valor: string; texto: string }[] };

export function EditarRapido(props: {
  titulo: string;
  campos: Campo[];
  ayuda?: ReactNode;
  alCerrar: () => void;
  /** Recibe los valores; los montos ya convertidos a centavos (texto). */
  alGuardar: (valores: Record<string, string>) => Promise<void>;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(props.campos.map((c) => [c.clave, c.valor])));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const listos: Record<string, string> = {};
    for (const c of props.campos) {
      const v = (valores[c.clave] ?? "").trim();
      if (c.tipo === "monto") {
        const m = leerMonto(v);
        if (!m.ok) return setError(`${c.etiqueta}: ${m.error}`);
        listos[c.clave] = m.centavos;
      } else {
        if (c.tipo === "texto" && c.requerido && !v) return setError(`Completá «${c.etiqueta}».`);
        listos[c.clave] = v;
      }
    }
    setGuardando(true);
    try {
      await props.alGuardar(listos);
    } catch (x) {
      setError(mensajeDe(x));
      setGuardando(false);
    }
  }

  return (
    <div className="capa" role="dialog" aria-modal="true" aria-labelledby="titulo-editar" onClick={(e) => e.target === e.currentTarget && props.alCerrar()}>
      <form className="tarjeta ventana" onSubmit={guardar}>
        <h2 id="titulo-editar">{props.titulo}</h2>
        {props.campos.map((c) => (
          <label className="campo" key={c.clave}>
            {c.etiqueta}
            {c.tipo === "opciones" ? (
              <select value={valores[c.clave]} onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}>
                {c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
              </select>
            ) : (
              <input
                type={c.tipo === "texto" && c.formato ? c.formato : "text"}
                inputMode={c.tipo === "monto" ? "decimal" : undefined}
                maxLength={c.tipo === "texto" ? (c.max ?? 120) : 20}
                value={valores[c.clave] ?? ""}
                onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
              />
            )}
          </label>
        ))}
        {props.ayuda && <p className="ayuda">{props.ayuda}</p>}
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        <button className="boton secundario" type="button" onClick={props.alCerrar}>Cancelar</button>
      </form>
    </div>
  );
}
