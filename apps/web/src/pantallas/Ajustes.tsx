import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ErrorApi, type AdminListado } from "../api";
import { useAdmin } from "../sesion";
import { PanelMercadoPago } from "./PruebaMercadoPago";

const MAXIMO_ADMINS = 5;

export function Ajustes() {
  const yo = useAdmin();
  if (yo.rol !== "DUENO") {
    return (
      <>
        <header className="encabezado">
          <Link to="/" className="volver">‹ 3T</Link>
          <h1>Ajustes</h1>
        </header>
        <main className="contenido">
          <MiContrasena />
        </main>
      </>
    );
  }
  return <AjustesDelDueno />;
}

function AjustesDelDueno() {
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

  async function restablecer(admin: AdminListado) {
    const nueva = window.prompt(
      `Nueva contraseña para ${admin.nombre} (al menos 10 letras o números). Se le cierra la sesión y se la tenés que pasar en persona:`,
    );
    if (nueva === null) return;
    setError(null);
    try {
      await api.restablecerContrasena(admin.id, nueva);
      setAviso(`${admin.nombre} ya puede entrar con la contraseña nueva. Pasásela en persona y pedile que la cambie.`);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo cambiar la contraseña.");
    }
  }

  return (
    <>
      <header className="encabezado">
        <Link to="/" className="volver">‹ 3T</Link>
        <h1>Ajustes</h1>
        <p className="sub">Los administradores solo ven su contraseña</p>
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
                <div className="fila fila-admin" key={a.id}>
                  <span className="datos">
                    <strong>{a.nombre}</strong>
                    <span>{a.email}{a.telefono ? ` · ${a.telefono}` : ""}</span>
                  </span>
                  <span className="acciones-cuota">
                    <button type="button" className="boton secundario chico" onClick={() => void restablecer(a)}>Nueva contraseña</button>
                    <button type="button" className="boton peligro" onClick={() => void desactivar(a)}>Desactivar</button>
                  </span>
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
        <MiContrasena />
        <PanelMercadoPago />
        <EmailDePrueba />
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

/** Cambiar la propia contraseña (todos). */
function MiContrasena() {
  const [abierto, setAbierto] = useState(false);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (nueva !== repetida) return setError("La contraseña nueva no coincide en los dos campos.");
    setGuardando(true);
    try {
      await api.cambiarMiContrasena(actual, nueva);
      setOk("Contraseña cambiada. Si tenías la app abierta en otro celular, ahí vas a tener que volver a entrar.");
      setAbierto(false);
      setActual("");
      setNueva("");
      setRepetida("");
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo cambiar la contraseña.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="tarjeta" aria-labelledby="titulo-contrasena">
      <h2 id="titulo-contrasena">Mi contraseña</h2>
      {ok && <p className="aviso ok" role="status">{ok}</p>}
      {!abierto && (
        <button type="button" className="boton secundario" onClick={() => { setAbierto(true); setOk(null); }}>Cambiar mi contraseña</button>
      )}
      {abierto && (
        <form className="panel" onSubmit={enviar}>
          <label className="campo">Contraseña actual<input type="password" autoComplete="current-password" required value={actual} onChange={(e) => setActual(e.target.value)} /></label>
          <label className="campo">Contraseña nueva (al menos 10 letras o números)<input type="password" autoComplete="new-password" required minLength={10} value={nueva} onChange={(e) => setNueva(e.target.value)} /></label>
          <label className="campo">Repetí la contraseña nueva<input type="password" autoComplete="new-password" required value={repetida} onChange={(e) => setRepetida(e.target.value)} /></label>
          {error && <p className="aviso error" role="alert">{error}</p>}
          <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Cambiar contraseña"}</button>
          <button className="boton secundario" type="button" onClick={() => setAbierto(false)}>Cancelar</button>
        </form>
      )}
    </section>
  );
}

/** Prueba de los emails de las entradas (dueño). */
/** Emails de las entradas: conectar plantelcuba@gmail.com (API de Gmail) y mandar uno de prueba. */
function EmailDePrueba() {
  const [cuenta, setCuenta] = useState<{ configurado: boolean; conectado: boolean; casilla: string; direccionDeVuelta: string } | null>(null);
  const [estado, setEstado] = useState<{ tipo: "ok" | "error"; texto: string } | null>(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("gmail") === "ok") return { tipo: "ok", texto: "Gmail quedó conectado. Ya salen los emails de las entradas." };
    if (q.get("gmail") === "error") return { tipo: "error", texto: q.get("motivo") ?? "No se pudo conectar Gmail." };
    return null;
  });
  const [mandando, setMandando] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("gmail")) window.history.replaceState(null, "", "/ajustes");
    api.estadoEmail().then(setCuenta).catch(() => setCuenta(null));
  }, []);

  const conectar = () => {
    setMandando(true);
    api.conectarGmail()
      .then((r) => { window.location.href = r.url; })
      .catch((e: unknown) => {
        setEstado({ tipo: "error", texto: e instanceof ErrorApi ? e.message : "No se pudo conectar." });
        setMandando(false);
      });
  };

  return (
    <section className="tarjeta" aria-labelledby="titulo-email">
      <h2 id="titulo-email">Emails de las entradas</h2>
      {cuenta && !cuenta.configurado && (
        <p className="ayuda">Falta cargar en Render las claves de Google (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET). Seguí el paso 7 de la guía.</p>
      )}
      {cuenta?.configurado && !cuenta.conectado && (
        <>
          <p className="ayuda">Los emails salen desde <strong>{cuenta.casilla}</strong>. Conectala una sola vez: entrás con esa cuenta y le das permiso a la app <em>solo para enviar</em> emails.</p>
          <button type="button" className="boton principal" disabled={mandando} onClick={conectar}>
            {mandando ? "Abriendo Google…" : "Conectar Gmail"}
          </button>
        </>
      )}
      {cuenta?.conectado && (
        <>
          <p className="ayuda">✅ Gmail conectado: los emails salen desde <strong>{cuenta.casilla}</strong>.</p>
          <button type="button" className="boton secundario" disabled={mandando}
            onClick={() => {
              setMandando(true);
              setEstado(null);
              api.emailDePrueba()
                .then((r) => setEstado({ tipo: "ok", texto: `Listo: te mandamos un email a ${r.enviadoA}. Fijate en spam si no lo ves.` }))
                .catch((e: unknown) => setEstado({ tipo: "error", texto: e instanceof ErrorApi ? e.message : "No se pudo mandar." }))
                .finally(() => setMandando(false));
            }}>
            {mandando ? "Mandando…" : "Mandarme un email de prueba"}
          </button>
          <button type="button" className="boton secundario" disabled={mandando} onClick={conectar}>Volver a conectar</button>
        </>
      )}
      {estado && <p className={`aviso ${estado.tipo}`} role="status">{estado.texto}</p>}
    </section>
  );
}
