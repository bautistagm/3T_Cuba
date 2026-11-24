import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./estilos.css";
import { StrictMode } from "react";
import { registerSW } from "virtual:pwa-register";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Instalacion, Login } from "./pantallas/Acceso";
import { Ajustes } from "./pantallas/Ajustes";
import { PantallaPagos } from "./pantallas/Pagos";
import { PantallaFiesta, PantallaFiestas } from "./pantallas/Fiestas";
import { PaginaComprarEntradas, PaginaMiEntrada } from "./pantallas/Entradas";
import { PantallaCaja } from "./pantallas/Caja";
import { PantallaCocina } from "./pantallas/Cocina";
import { Inicio } from "./pantallas/Inicio";
import { PaginaDelResponsable } from "./pantallas/Responsable";
import { PantallaSabado } from "./pantallas/Sabado";
import { SeccionEnConstruccion } from "./pantallas/Seccion";
import { ProveedorSesion, useSesion } from "./sesion";

function App() {
  const { estado, reintentar } = useSesion();

  switch (estado.tipo) {
    case "cargando":
      return (
        <main className="centrado">
          <img src="/escudo.png" alt="" width={60} height={82} />
          <div className="cargando" aria-label="Cargando" />
          <p className="ayuda">Si la app estuvo un rato sin usarse, puede tardar hasta un minuto en despertar.</p>
        </main>
      );
    case "sin-conexion":
      return (
        <main className="centrado">
          <p className="aviso error" role="alert">{estado.mensaje}</p>
          <button type="button" className="boton principal" onClick={reintentar}>Reintentar</button>
        </main>
      );
    case "instalacion":
      return <Instalacion habilitada={estado.habilitada} />;
    case "sin-sesion":
      return <Login />;
    case "con-sesion":
      return (
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/sabados" element={<PantallaSabado />} />
          <Route path="/sabados/:id" element={<PantallaSabado />} />
          <Route path="/cocinas/:id" element={<PantallaCocina />} />
          <Route path="/pagos" element={<PantallaPagos />} />
          <Route path="/fiestas" element={<PantallaFiestas />} />
          <Route path="/fiestas/:id" element={<PantallaFiesta />} />
          <Route path="/caja" element={<PantallaCaja />} />
          <Route path="/stock" element={<SeccionEnConstruccion titulo="Stock" cuando="Llega en 2027." />} />
          <Route path="/ajustes" element={<Ajustes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      );
  }
}

/** Las páginas públicas (link del responsable) no necesitan sesión. */
function Raiz() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/cocina/") || pathname.startsWith("/entradas/") || pathname.startsWith("/mi-entrada/")) {
    return (
      <Routes>
        <Route path="/cocina/:token" element={<PaginaDelResponsable />} />
        <Route path="/entradas/:token" element={<PaginaComprarEntradas />} />
        <Route path="/mi-entrada/:codigo" element={<PaginaMiEntrada />} />
      </Routes>
    );
  }
  return (
    <ProveedorSesion>
      <App />
    </ProveedorSesion>
  );
}

// Cuando se publica una versión nueva, la app se actualiza y recarga sola
// (sin esto, el celular seguía mostrando la versión guardada hasta abrirla dos veces).
const actualizar = registerSW({
  immediate: true,
  onRegisteredSW(_url, registro) {
    if (!registro) return;
    // Además, se fija cada 30 minutos si hay una versión nueva (por si la app queda abierta).
    setInterval(() => void registro.update(), 30 * 60 * 1000);
  },
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void actualizar(true);
});

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Falta el elemento #raiz");
createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <Raiz />
    </BrowserRouter>
  </StrictMode>,
);
