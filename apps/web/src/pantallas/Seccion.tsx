import { Link } from "react-router";

/** Pantalla provisoria para las secciones que todavía se están construyendo. */
export function SeccionEnConstruccion({ titulo, cuando }: { titulo: string; cuando: string }) {
  return (
    <>
      <header className="encabezado">
        <Link to="/" className="volver">‹ 3T</Link>
        <h1>{titulo}</h1>
      </header>
      <main className="centrado">
        <span className="chip azul">En construcción</span>
        <p className="ayuda">{cuando}</p>
        <Link to="/" className="boton secundario">Volver al inicio</Link>
      </main>
    </>
  );
}
