import { useState, type FormEvent } from "react";
import { api, ErrorApi } from "../api";
import { DecoracionRugby } from "../ilustraciones";
import { useSesion } from "../sesion";

function Portada({ titulo }: { titulo: string }) {
  return (
    <header className="portada">
      <DecoracionRugby />
      <img className="escudo" src="/escudo.png" alt="Escudo del club" />
      <span className="marca">3T</span>
      <span className="saludo">{titulo}</span>
    </header>
  );
}

export function Login() {
  const { entrar } = useSesion();
  const [email, setEmail] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const { admin } = await api.login(email, contrasena);
      entrar(admin);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo iniciar sesión.");
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <Portada titulo="Tercer tiempo del plantel" />
      <main className="contenido">
        <form className="tarjeta" onSubmit={enviar}>
          <h2>Iniciar sesión</h2>
          <label className="campo">
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="campo">
            Contraseña
            <input type="password" autoComplete="current-password" required value={contrasena}
              onChange={(e) => setContrasena(e.target.value)} />
          </label>
          {error && <p className="aviso error" role="alert">{error}</p>}
          <button className="boton principal" type="submit" disabled={enviando}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </main>
    </div>
  );
}

export function Instalacion({ habilitada }: { habilitada: boolean }) {
  const { entrar } = useSesion();
  const [datos, setDatos] = useState({ codigo: "", nombre: "", email: "", contrasena: "", repetida: "" });
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (campo: keyof typeof datos) => (e: { target: { value: string } }) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }));

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (datos.contrasena !== datos.repetida) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const { admin } = await api.instalar({
        codigo: datos.codigo.trim(),
        nombre: datos.nombre,
        email: datos.email,
        contrasena: datos.contrasena,
      });
      entrar(admin);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : "No se pudo crear la cuenta.");
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <Portada titulo="Primera vez: crear la cuenta del dueño" />
      <main className="contenido">
        {!habilitada ? (
          <p className="aviso error" role="alert">
            Falta cargar el código de instalación en el servidor (variable CODIGO_INSTALACION en Render).
          </p>
        ) : (
          <form className="tarjeta" onSubmit={enviar}>
            <h2>Crear cuenta del dueño</h2>
            <p className="ayuda">Esto se hace una sola vez. Usá el código de instalación que cargaste en Render.</p>
            <label className="campo">
              Código de instalación
              <input autoComplete="off" required value={datos.codigo} onChange={cambiar("codigo")} />
            </label>
            <label className="campo">
              Tu nombre
              <input autoComplete="name" required minLength={2} value={datos.nombre} onChange={cambiar("nombre")} />
            </label>
            <label className="campo">
              Email
              <input type="email" autoComplete="username" required value={datos.email} onChange={cambiar("email")} />
            </label>
            <label className="campo">
              Contraseña (mínimo 10 caracteres)
              <input type="password" autoComplete="new-password" required minLength={10} value={datos.contrasena}
                onChange={cambiar("contrasena")} />
            </label>
            <label className="campo">
              Repetí la contraseña
              <input type="password" autoComplete="new-password" required minLength={10} value={datos.repetida}
                onChange={cambiar("repetida")} />
            </label>
            {error && <p className="aviso error" role="alert">{error}</p>}
            <button className="boton principal" type="submit" disabled={enviando}>
              {enviando ? "Creando…" : "Crear cuenta y entrar"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
