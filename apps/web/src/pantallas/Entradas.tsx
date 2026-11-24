import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import QRCode from "qrcode";
import { formatearDni } from "@3t/shared";
import { api, type EstadoCompra, type VentaPublica } from "../api";
import { mensajeDe } from "../componentes/comunes";
import { DecoracionRugby } from "../ilustraciones";
import { pesos } from "../plata";

const fechaFiesta = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));

function Portada(props: { titulo: string }) {
  return (
    <header className="portada">
      <DecoracionRugby />
      <img className="escudo" src="/escudo.png" alt="Escudo del club" />
      <span className="marca">3T</span>
      <span className="saludo">{props.titulo}</span>
    </header>
  );
}

function CopiarAlias(props: { alias: string | null }) {
  const [copiado, setCopiado] = useState(false);
  if (!props.alias) return <p className="aviso error">Todavía no está cargado el alias del plantel. Avisale a quien te pasó el link.</p>;
  return (
    <div className="alias">
      <span className="ayuda">Alias para transferir</span>
      <strong>{props.alias}</strong>
      <button type="button" className="boton secundario chico"
        onClick={() => {
          void navigator.clipboard?.writeText(props.alias ?? "").then(() => setCopiado(true)).catch(() => undefined);
        }}>
        {copiado ? "¡Copiado!" : "Copiar alias"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comprar (link público de venta)
// ---------------------------------------------------------------------------

export function PaginaComprarEntradas() {
  const { token = "" } = useParams();
  const navegar = useNavigate();
  const [venta, setVenta] = useState<VentaPublica | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState([{ nombre: "", dni: "" }]);
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.ventaPublica(token).then(setVenta).catch((e: unknown) => setError(mensajeDe(e)));
  }, [token]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const r = await api.comprarEntradas(token, { entradas: personas, email, ...(telefono.trim() ? { telefono } : {}) });
      try {
        localStorage.setItem(`compra:${token}`, r.codigoConsulta);
      } catch {
        // Sin almacenamiento: no pasa nada, el link de la compra igual sirve.
      }
      navegar(`/mi-entrada/${r.codigoConsulta}`);
    } catch (e) {
      setError(mensajeDe(e));
      setEnviando(false);
    }
  }

  const total = venta ? BigInt(venta.tipo.precioCentavos) * BigInt(personas.length) : 0n;
  return (
    <div className="acceso">
      <Portada titulo={venta ? venta.fiesta.nombre : "Entradas"} />
      <main className="contenido">
        {error && <p className="aviso error" role="alert">{error}</p>}
        {!venta && !error && <div className="cargando" aria-label="Cargando" />}
        {venta && (
          <>
            <section className="tarjeta">
              <h2>Entrada {venta.tipo.nombre} · {pesos(venta.tipo.precioCentavos)}</h2>
              <p className="ayuda">{fechaFiesta(venta.fiesta.fechaHora)}{venta.fiesta.lugar ? ` · ${venta.fiesta.lugar}` : ""}</p>
              {!venta.abierta && <p className="aviso error">La venta para esta fiesta está cerrada.</p>}
            </section>
            {venta.abierta && (
              <form className="tarjeta" onSubmit={enviar}>
                <h2>Tus datos</h2>
                <p className="ayuda">
                  Las entradas son con nombre y DNI. <strong>En la puerta se controla el DNI</strong>: esta entrada es para <strong>{venta.tipo.nombre}</strong>.
                </p>
                {personas.map((p, i) => (
                  <div className="panel" key={i}>
                    <strong>{i === 0 ? "Vos (quien transfiere)" : `Entrada ${i + 1}`}</strong>
                    <label className="campo">Nombre y apellido<input required autoComplete={i === 0 ? "name" : "off"} value={p.nombre}
                      onChange={(e) => setPersonas(personas.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} /></label>
                    <label className="campo">DNI<input required inputMode="numeric" autoComplete="off" value={p.dni}
                      onChange={(e) => setPersonas(personas.map((x, j) => (j === i ? { ...x, dni: e.target.value } : x)))} /></label>
                    {i > 0 && <button type="button" className="enlace" onClick={() => setPersonas(personas.filter((_, j) => j !== i))}>Quitar esta entrada</button>}
                  </div>
                ))}
                {personas.length < 10 && (
                  <button type="button" className="boton secundario chico" onClick={() => setPersonas([...personas, { nombre: "", dni: "" }])}>+ Otra entrada {venta.tipo.nombre}</button>
                )}
                <label className="campo">Email (ahí te llegan las entradas)<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                <label className="campo">Celular (opcional)<input inputMode="tel" autoComplete="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} /></label>
                <p className="aviso ok">
                  Después vas a transferir <strong>{pesos(total)}</strong> al alias del plantel <strong>desde una cuenta a tu nombre</strong> (con tu DNI). Así se acredita sola.
                </p>
                <button className="boton principal" type="submit" disabled={enviando}>{enviando ? "Guardando…" : "Continuar"}</button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mi entrada (estado de la compra y QR)
// ---------------------------------------------------------------------------

function CodigoQr(props: { texto: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(props.texto, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg).catch(() => setSvg(null));
  }, [props.texto]);
  // El SVG lo genera la librería a partir de un código nuestro (letras y números): no hay contenido de terceros.
  return svg ? <div className="qr" role="img" aria-label="Código QR de la entrada" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="cargando" />;
}

export function PaginaMiEntrada() {
  const { codigo = "" } = useParams();
  const [compra, setCompra] = useState<EstadoCompra | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCompra(await api.estadoCompra(codigo));
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, [codigo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);
  // Mientras espera la transferencia, se fija sola cada 30 segundos.
  useEffect(() => {
    if (compra?.estado !== "PENDIENTE_PAGO") return;
    const t = setInterval(() => void cargar(), 30_000);
    return () => clearInterval(t);
  }, [compra?.estado, cargar]);

  return (
    <div className="acceso">
      <Portada titulo={compra ? compra.fiesta.nombre : "Mi entrada"} />
      <main className="contenido">
        {error && <p className="aviso error" role="alert">{error}</p>}
        {!compra && !error && <div className="cargando" aria-label="Cargando" />}
        {compra?.estado === "PENDIENTE_PAGO" && (
          <section className="tarjeta">
            <h2>Falta la transferencia</h2>
            {compra.existente && <p className="ayuda">Ya tenías esta compra guardada.</p>}
            <p>
              Transferí <strong>{pesos(compra.totalCentavos)}</strong> ({compra.cantidad} {compra.cantidad === 1 ? "entrada" : "entradas"} {compra.tipo}) desde una cuenta a nombre del DNI <strong>{formatearDni(compra.dniPagador)}</strong>.
            </p>
            <CopiarAlias alias={compra.alias} />
            <p className="ayuda">
              Cuando llegue la plata, esta página se actualiza sola y te mostramos el QR. Guardá este link para volver: <strong>{window.location.href}</strong>
            </p>
            <p className="ayuda">¿Transferiste desde otra cuenta o por otro monto? Tranqui: lo revisa una persona del plantel.</p>
            <button type="button" className="boton secundario" onClick={() => void cargar()}>Ya transferí, fijate de nuevo</button>
          </section>
        )}
        {compra?.estado === "PAGADA" && (
          <>
            <p className="aviso ok" role="status">¡Listo! Tu pago se acreditó. Mostrá el QR en la puerta junto con tu DNI.</p>
            {compra.entradas.map((e) => (
              <section className="tarjeta entrada" key={e.dni}>
                <h2>{e.nombre}</h2>
                <p className="ayuda">DNI {formatearDni(e.dni)} · Entrada {compra.tipo} · {fechaFiesta(compra.fiesta.fechaHora)}</p>
                {e.codigo ? <CodigoQr texto={e.codigo} /> : <p className="aviso error">Esta entrada fue anulada.</p>}
                {e.estado === "USADA" && <p className="aviso error">Esta entrada ya se usó.</p>}
              </section>
            ))}
          </>
        )}
        {compra?.estado === "ANULADA" && <p className="aviso error">Esta compra fue anulada. Si creés que es un error, escribile al plantel.</p>}
      </main>
    </div>
  );
}
