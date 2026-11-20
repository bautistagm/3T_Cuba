import { useState, type FormEvent } from "react";
import type { Categoria } from "../api";
import { leerMonto, pesos } from "../plata";

export const NOMBRES_CATEGORIA: Record<Categoria, string> = {
  CARNE: "Carne",
  BEBIDAS: "Bebidas",
  INSUMOS: "Insumos (pan, carbón, hielo…)",
  OTROS: "Otros",
};

export interface FilaEditable {
  descripcion: string;
  cantidad: string;
  categoria: Categoria;
  importe: string;
}

export interface ItemListo {
  descripcion: string;
  cantidad?: string;
  categoria: Categoria;
  subtotalCentavos: string;
}

const filaVacia = (): FilaEditable => ({ descripcion: "", cantidad: "", categoria: "CARNE", importe: "" });

/** Carga o corrección de un gasto, producto por producto. */
export function EditorItems(props: {
  iniciales?: FilaEditable[];
  proveedorInicial?: string;
  textoBoton: string;
  alGuardar: (datos: { proveedor?: string; items: ItemListo[] }) => Promise<void>;
  alCancelar?: () => void;
}) {
  const [proveedor, setProveedor] = useState(props.proveedorInicial ?? "");
  const [filas, setFilas] = useState<FilaEditable[]>(props.iniciales?.length ? props.iniciales : [filaVacia()]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (i: number, campo: keyof FilaEditable, valor: string) =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  let total = 0n;
  let totalValido = true;
  for (const f of filas) {
    const m = leerMonto(f.importe);
    if (m.ok) total += BigInt(m.centavos);
    else totalValido = false;
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const items: ItemListo[] = [];
    for (const [i, f] of filas.entries()) {
      if (!f.descripcion.trim()) return setError(`Falta la descripción del producto ${i + 1}.`);
      const m = leerMonto(f.importe);
      if (!m.ok) return setError(`Producto ${i + 1}: ${m.error}`);
      items.push({
        descripcion: f.descripcion.trim(),
        categoria: f.categoria,
        subtotalCentavos: m.centavos,
        ...(f.cantidad.trim() ? { cantidad: f.cantidad.trim() } : {}),
      });
    }
    setEnviando(true);
    try {
      await props.alGuardar({ items, ...(proveedor.trim() ? { proveedor: proveedor.trim() } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <label className="campo">
        Comercio (opcional)
        <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej: Carnicería" />
      </label>
      {filas.map((f, i) => (
        <fieldset key={i} className="producto">
          <legend>Producto {i + 1}</legend>
          <label className="campo">
            Descripción
            <input value={f.descripcion} onChange={(e) => cambiar(i, "descripcion", e.target.value)} required />
          </label>
          <div className="dos-columnas">
            <label className="campo">
              Cantidad (opcional)
              <input value={f.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} placeholder="Ej: 15 kg" />
            </label>
            <label className="campo">
              Importe
              <input inputMode="decimal" value={f.importe} onChange={(e) => cambiar(i, "importe", e.target.value)} placeholder="Ej: 120.000" required />
            </label>
          </div>
          <label className="campo">
            Categoría
            <select value={f.categoria} onChange={(e) => cambiar(i, "categoria", e.target.value)}>
              {(Object.keys(NOMBRES_CATEGORIA) as Categoria[]).map((c) => (
                <option key={c} value={c}>{NOMBRES_CATEGORIA[c]}</option>
              ))}
            </select>
          </label>
          {filas.length > 1 && (
            <button type="button" className="enlace" onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}>
              Quitar este producto
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="boton secundario" onClick={() => setFilas((fs) => [...fs, filaVacia()])}>
        + Otro producto
      </button>
      <p className="total-linea">
        Total: <strong>{totalValido ? pesos(total) : "revisá los importes"}</strong>
      </p>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={enviando}>{enviando ? "Guardando…" : props.textoBoton}</button>
      {props.alCancelar && (
        <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
      )}
    </form>
  );
}
