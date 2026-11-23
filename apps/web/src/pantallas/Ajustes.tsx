import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ErrorApi, type AdminListado } from "../api";
import { useAdmin } from "../sesion";
import { PanelMercadoPago } from "./PruebaMercadoPago";

const MAXIMO_ADMINS = 5;

export function Ajustes() {
  const yo = useAdmin();
  const [admins, setAdmins] = useState<AdminListado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setAdmins((await api.listarAdmins()).admins);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo cargar la lista.");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const activos = admins?.filter((a) => a.rol === "ADMIN" && a.activo) ?? [];
  const inactivos = admins?.filter((a) => a.rol === "ADMIN" && !a.activo) ?? [];

  async function desactivar(admin: AdminListado) {
    const seguro = window.confirm(
      `¿Desactivar a ${admin.nombre}? No va a poder entrar más y se le cierra la sesión. Su historial queda guardado.`,
    );
    if (!seguro) return;
    setError(null);
    try {
      await api.desactivarAdmin(admin.id);
      setAviso(`${admin.nombre} quedó desactivado.`);
      await cargar();
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo desactivar.");
    }
  }

  return (
    <>
      <header className="encabezado">
        <Link to="/" className="volver">‹ 3T</Link>
        <h1>Ajustes</h1>
        <p className="sub">Solo vos ves esta pantalla</p>
      </header>
      <main className="contenido">
        <section className="tarjeta" aria-labelledby="titulo-admins">
          <h2 id="titulo-admins">Administradores ({activos.length} de {MAXIMO_ADMINS})</h2>
          <p className="ayuda">
            Pueden registrar pagos, gastos y cobros. No pueden anular, eliminar ni cambiar montos: eso lo hacés vos.
          </p>
          {error && <p className="aviso error" role="alert">{error}</p>}
          {aviso && <p className="aviso ok" role="status">{aviso}</p>}
          {admins === null && !error && <div className="cargando" aria-label="Cargando" />}
          {admins !== null && (
            <div>
              <div className="fila">
                <span className="datos">
                  <strong>{yo.nombre}</strong>
                  <span>{yo.email}</span>
                </span>
                <span className="chip azul">Dueño</span>
              </div>
              {activos.map((a) => (
                <div className="fila" key={a.id}>
                  <span className="datos">
                    <strong>{a.nombre}</strong>
                    <span>{a.email}{a.telefono ? ` · ${a.telefono}` : ""}</span>
                  </span>
                  <button type="button" className="boton peligro" onClick={() => void desactivar(a)}>Desactivar</button>
                </div>
              ))}
            </div>
          )}
          {activos.length < MAXIMO_ADMINS && !mostrarForm && admins !== null && (
            <button type="button" className="boton secundario" onClick={() => { setMostrarForm(true); setAviso(null); }}>
              + Agregar administrador
            </button>
          )}
          {mostrarForm && (
            <FormNuevoAdmin
              alCancelar={() => setMostrarForm(false)}
              alCrear={async (nombre) => {
                setMostrarForm(false);
                setAviso(`${nombre} ya puede entrar con su email y la contraseña que le pusiste. Pasásela en persona.`);
                await cargar();
              }}
            />
          )}
        </section>
        {inactivos.length > 0 && (
          <section className="tarjeta" aria-labelledby="titulo-inactivos">
            <h2 id="titulo-inactivos">Desactivados</h2>
            {inactivos.map((a) => (
              <div className="fila" key={a.id}>
                <span className="datos">
                  <strong>{a.nombre}</strong>
                  <span>{a.email}</span>
                </span>
              </div>
            ))}
          </section>
        )}
        <PanelMercadoPago />
      </main>
    </>
  );
}

function FormNuevoAdmin(props: { alCancelar: () => void; alCrear: (nombre: string) => Promise<void> }) {
  const [datos, setDatos] = useState({ nombre: "", email: "", telefono: "", contrasena: "" });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo: keyof typeof datos) => (e: { target: { value: string } }) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const telefono = datos.telefono.trim();
      await api.crearAdmin({
        nombre: datos.nombre,
        email: datos.email,
        contrasena: datos.contrasena,
        ...(telefono ? { telefono } : {}),
      });
      await props.alCrear(datos.nombre);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo crear el administrador.");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <label className="campo">
        Nombre
        <input required minLength={2} value={datos.nombre} onChange={cambiar("nombre")} />
      </label>
      <label className="campo">
        Email
        <input type="email" required value={datos.email} onChange={cambiar("email")} />
      </label>
      <label className="campo">
        Teléfono (opcional)
        <input type="tel" value={datos.telefono} onChange={cambiar("telefono")} />
      </label>
      <label className="campo">
        Contraseña inicial (mínimo 10 caracteres)
        <input type="text" autoComplete="off" required minLength={10} value={datos.contrasena} onChange={cambiar("contrasena")} />
      </label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Agregar"}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}
