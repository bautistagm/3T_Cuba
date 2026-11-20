import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ErrorApi } from "../api";

export function Encabezado(props: { volverA: string; volverTexto: string; titulo: string; sub?: string | undefined }) {
  return (
    <header className="encabezado">
      <Link to={props.volverA} className="volver">‹ {props.volverTexto}</Link>
      <h1>{props.titulo}</h1>
      {props.sub && <p className="sub">{props.sub}</p>}
    </header>
  );
}

export function Cargando() {
  return (
    <main className="centrado">
      <div className="cargando" aria-label="Cargando" />
    </main>
  );
}

export const mensajeDe = (e: unknown) => (e instanceof ErrorApi || e instanceof Error ? e.message : "Algo salió mal.");

/** Pide el motivo para anular. Devuelve null si se cancela. */
export function pedirMotivo(que: string): string | null {
  const motivo = window.prompt(`¿Por qué anulás ${que}? (queda registrado)`);
  if (motivo === null) return null;
  if (motivo.trim().length < 5) {
    window.alert("Escribí un motivo un poco más largo.");
    return null;
  }
  return motivo.trim();
}

/** Un aviso que se va solo a los pocos segundos. */
export function useAviso() {
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "ok" ? 4000 : 9000);
    return () => clearTimeout(t);
  }, [aviso]);
  const Aviso = () =>
    aviso ? (
      <p className={`aviso ${aviso.tipo}`} role={aviso.tipo === "error" ? "alert" : "status"}>{aviso.texto}</p>
    ) : null;
  return { setAviso, Aviso };
}

export function SelectorMedio(props: { valor: "EFECTIVO" | "TRANSFERENCIA"; alCambiar: (m: "EFECTIVO" | "TRANSFERENCIA") => void }) {
  return (
    <div className="segmentado" role="radiogroup" aria-label="Medio de pago">
      {(["EFECTIVO", "TRANSFERENCIA"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={props.valor === m}
          className={props.valor === m ? "activo" : ""}
          onClick={() => props.alCambiar(m)}
        >
          {m === "EFECTIVO" ? "Efectivo" : "Transferencia"}
        </button>
      ))}
    </div>
  );
}
