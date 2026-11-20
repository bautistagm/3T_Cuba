import type { ReactNode } from "react";
import { Link } from "react-router";
import { DecoracionRugby, DibujoCaja, DibujoFiestas, DibujoPagos, DibujoSabados, DibujoStock } from "../ilustraciones";
import { useAdmin, useSesion } from "../sesion";

const fechaDeHoy = () =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

function TarjetaSeccion(props: { a: string; titulo: string; desc: string; chip: string; chipColor?: string; dibujo: ReactNode }) {
  return (
    <Link to={props.a} className="seccion">
      <span className="textos">
        <strong>{props.titulo}</strong>
        <span className="desc">{props.desc}</span>
        <span className={`chip ${props.chipColor ?? "gris"}`}>{props.chip}</span>
      </span>
      {props.dibujo}
    </Link>
  );
}

export function Inicio() {
  const admin = useAdmin();
  const { salir } = useSesion();
  const primerNombre = admin.nombre.split(" ")[0];

  return (
    <>
      <header className="portada">
        <DecoracionRugby />
        <div className="acciones">
          {admin.rol === "DUENO" && (
            <Link to="/ajustes" className="icono-boton" aria-label="Ajustes">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
              </svg>
            </Link>
          )}
          <button type="button" className="icono-boton" aria-label="Cerrar sesión" onClick={() => void salir()}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
        <img className="escudo" src="/escudo.png" alt="Escudo del club" />
        <span className="marca">3T</span>
        <span className="saludo">Hola, {primerNombre} · {fechaDeHoy()}</span>
      </header>

      <main className="contenido">
        <TarjetaSeccion a="/sabados" titulo="Sábados" desc="Invitados del tercer tiempo y la cocina de la camada" chip="Listo para usar" chipColor="azul" dibujo={<DibujoSabados />} />
        <TarjetaSeccion a="/pagos" titulo="Pagos" desc="Cuotas, comprobantes y efectivo" chip="En construcción" dibujo={<DibujoPagos />} />
        <TarjetaSeccion a="/fiestas" titulo="Fiestas" desc="Entradas para gente de afuera y control en la puerta" chip="En construcción" dibujo={<DibujoFiestas />} />
        <TarjetaSeccion a="/caja" titulo="Caja" desc="Todo lo que entra y sale: saldo, gastos y efectivo" chip="En construcción" dibujo={<DibujoCaja />} />
        <TarjetaSeccion a="/stock" titulo="Stock" desc="Almacén, cierre del sábado y proveedores" chip="Llega en 2027" dibujo={<DibujoStock />} />
      </main>
      <footer className="pie">{admin.rol === "DUENO" ? "Sos el dueño de 3T" : "Administrador"}</footer>
    </>
  );
}
