import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./estilos.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Instalacion, Login } from "./pantallas/Acceso";
import { Ajustes } from "./pantallas/Ajustes";
import { Inicio } from "./pantallas/Inicio";
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
          <Route path="/pagos" element={<SeccionEnConstruccion titulo="Pagos" cuando="Se construye con los jugadores de prueba y queda lista para cargar a los reales en febrero." />} />
          <Route path="/fiestas" element={<SeccionEnConstruccion titulo="Fiestas" cuando="Llega después de Sábados, Caja y la verificación de transferencias." />} />
          <Route path="/caja" element={<SeccionEnConstruccion titulo="Caja" cuando="Llega después de Sábados." />} />
          <Route path="/stock" element={<SeccionEnConstruccion titulo="Stock" cuando="Llega en 2027." />} />
          <Route path="/ajustes" element={estado.admin.rol === "DUENO" ? <Ajustes /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      );
  }
}

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("Falta el elemento #raiz");
createRoot(raiz).render(
  <StrictMode>
    <BrowserRouter>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </BrowserRouter>
  </StrictMode>,
);
