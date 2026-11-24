/**
 * Puerta de la fiesta (link secreto, sin usuario): escanear los QR con la cámara del celular.
 *
 * - La lista se guarda en el celular, así sigue andando sin señal. Los ingresos sin señal quedan en una cola
 *   y se mandan solos cuando vuelve.
 * - Con señal, cada QR se confirma con el servidor (así dos celulares no dejan entrar la misma entrada).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { formatearDni } from "@3t/shared";

type EstadoEntrada = "VALIDA" | "USADA" | "ANULADA";
interface EntradaPuerta {
  id: string;
  huella: string;
  nombre: string;
  dni: string;
  tipoId: string;
  estado: EstadoEntrada;
  usadaEn: string | null;
  usadaPor: string | null;
}
interface ListaPuerta {
  fiesta: { nombre: string; fechaHora: string; lugar: string | null };
  tipos: { id: string; nombre: string }[];
  entradas: EntradaPuerta[];
  actualizadaEn: string;
}
interface Ingreso {
  id: string;
  codigo?: string;
  entradaId?: string;
  por: string;
  en: string;
  /** Solo en el celular: qué entrada de la lista es (no se manda). */
  entradaLocal?: string;
}
type Resultado = "ENTRO" | "YA_ENTRO" | "ANULADA" | "SIN_PAGAR" | "NO_EXISTE";
interface RespuestaIngreso {
  id: string;
  resultado: Resultado;
  entrada: { id: string; nombre: string; dni: string; tipoId: string; usadaEn: string | null; usadaPor: string | null } | null;
}
interface Pantallazo {
  verde: boolean;
  titulo: string;
  nombre?: string | undefined;
  detalle?: string | undefined;
  nota?: string | undefined;
}

// --- Lo que se guarda en el celular (si el navegador no deja, sigue andando en memoria) ---
const guardado = {
  leer<T>(clave: string): T | null {
    try {
      const v = localStorage.getItem(clave);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  escribir(clave: string, valor: unknown) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch {
      /* sin lugar o bloqueado: se sigue en memoria */
    }
  },
};

const hora = (iso: string) => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function huellaDe(codigo: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codigo)));
    let binario = "";
    bytes.forEach((b) => (binario += String.fromCharCode(b)));
    return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return null;
  }
}

class SinSenal extends Error {}
async function pedirPuerta<T>(ruta: string, cuerpo?: unknown, esperaMs = 5000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/publico/puerta/${ruta}`, {
      method: cuerpo === undefined ? "GET" : "POST",
      headers: cuerpo === undefined ? {} : { "content-type": "application/json" },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(esperaMs),
    });
  } catch {
    throw new SinSenal();
  }
  const datos: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const error = (datos as { error?: { codigo?: string; mensaje?: string } } | null)?.error;
    if (r.status >= 500 || r.status === 429) throw new SinSenal();
    throw Object.assign(new Error(error?.mensaje ?? "Algo salió mal."), { codigo: error?.codigo });
  }
  return datos as T;
}

export function PaginaPuerta() {
  const { token = "" } = useParams();
  const claveLista = `3t-puerta-lista-${token}`;
  const claveCola = `3t-puerta-cola-${token}`;
  const [lista, setLista] = useState<ListaPuerta | null>(() => guardado.leer<ListaPuerta>(claveLista));
  const [cola, setCola] = useState<Ingreso[]>(() => guardado.leer<Ingreso[]>(claveCola) ?? []);
  const [nombre, setNombre] = useState(() => guardado.leer<string>("3t-puerta-nombre") ?? "");
  const [linkMalo, setLinkMalo] = useState<string | null>(null);
  const [conSenal, setConSenal] = useState(true);
  const [modo, setModo] = useState<"camara" | "buscar">("camara");
  const [pantallazo, setPantallazo] = useState<Pantallazo | null>(null);
  const colaRef = useRef(cola);
  colaRef.current = cola;

  const guardarCola = useCallback(
    (nueva: Ingreso[]) => {
      colaRef.current = nueva;
      setCola(nueva);
      guardado.escribir(claveCola, nueva);
    },
    [claveCola],
  );

  /** Aplica a la lista local lo que dijo el servidor o lo que se marcó sin señal. */
  const marcarLocal = useCallback(
    (entradaId: string, cambios: Partial<EntradaPuerta>) => {
      setLista((l) => {
        if (!l) return l;
        const nueva = { ...l, entradas: l.entradas.map((e) => (e.id === entradaId ? { ...e, ...cambios } : e)) };
        guardado.escribir(claveLista, nueva);
        return nueva;
      });
    },
    [claveLista],
  );

  const bajarLista = useCallback(async () => {
    try {
      const nueva = await pedirPuerta<ListaPuerta>(token);
      // Lo que este celular marcó sin señal y todavía no se mandó sigue figurando como "entró".
      for (const i of colaRef.current) {
        const e = nueva.entradas.find((x) => x.id === (i.entradaLocal ?? i.entradaId));
        if (e && e.estado === "VALIDA") Object.assign(e, { estado: "USADA", usadaEn: i.en, usadaPor: i.por });
      }
      setLista(nueva);
      guardado.escribir(claveLista, nueva);
      setConSenal(true);
      setLinkMalo(null);
    } catch (e) {
      if (e instanceof SinSenal) setConSenal(false);
      else setLinkMalo(e instanceof Error ? e.message : "Este link no anda.");
    }
  }, [token, claveLista]);

  const mandarCola = useCallback(async () => {
    const pendientes = colaRef.current;
    if (pendientes.length === 0) return;
    try {
      const r = await pedirPuerta<{ resultados: RespuestaIngreso[] }>(`${token}/ingresos`, { ingresos: pendientes.slice(0, 200).map((i) => ({ id: i.id, por: i.por, en: i.en, ...(i.codigo ? { codigo: i.codigo } : { entradaId: i.entradaId }) })) });
      const listos = new Set(r.resultados.map((x) => x.id));
      for (const x of r.resultados) {
        if (x.entrada) marcarLocal(x.entrada.id, { estado: x.resultado === "ANULADA" ? "ANULADA" : "USADA", usadaEn: x.entrada.usadaEn, usadaPor: x.entrada.usadaPor });
      }
      const choques = r.resultados.filter((x) => x.resultado === "YA_ENTRO");
      if (choques.length > 0) {
        setPantallazo({
          verde: false,
          titulo: "Ojo: al sincronizar",
          detalle: choques.map((x) => `${x.entrada?.nombre ?? "?"} ya había entrado ${x.entrada?.usadaEn ? `a las ${hora(x.entrada.usadaEn)}` : ""} (${x.entrada?.usadaPor ?? "otro celular"})`).join(" · "),
          nota: "Mientras no había señal la dejaste pasar, pero esa entrada ya se había usado en otro celular.",
        });
      }
      guardarCola(colaRef.current.filter((i) => !listos.has(i.id)));
      setConSenal(true);
    } catch (e) {
      if (e instanceof SinSenal) setConSenal(false);
    }
  }, [token, marcarLocal, guardarCola]);

  useEffect(() => {
    void bajarLista().then(mandarCola);
    const cada = window.setInterval(() => void mandarCola().then(bajarLista), 30_000);
    const alVolver = () => void mandarCola().then(bajarLista);
    window.addEventListener("online", alVolver);
    return () => {
      window.clearInterval(cada);
      window.removeEventListener("online", alVolver);
    };
  }, [bajarLista, mandarCola]);

  const tipoDe = useCallback((tipoId: string) => lista?.tipos.find((t) => t.id === tipoId)?.nombre ?? "", [lista]);

  /** Dejar pasar: con señal lo confirma el servidor; sin señal decide con la lista del celular. */
  const ingresar = useCallback(
    async (datos: { codigo: string } | { entradaId: string }) => {
      const ingreso: Ingreso = { id: crypto.randomUUID(), por: nombre, en: new Date().toISOString(), ...datos };
      const local =
        "entradaId" in datos
          ? lista?.entradas.find((e) => e.id === datos.entradaId)
          : await huellaDe(datos.codigo).then((h) => (h ? lista?.entradas.find((e) => e.huella === h) : undefined));
      try {
        const r = await pedirPuerta<{ resultados: RespuestaIngreso[] }>(`${token}/ingresos`, { ingresos: [ingreso] }, 4000);
        const x = r.resultados[0];
        setConSenal(true);
        if (!x) return;
        if (x.entrada) marcarLocal(x.entrada.id, { estado: x.resultado === "ANULADA" ? "ANULADA" : x.resultado === "SIN_PAGAR" ? "VALIDA" : "USADA", usadaEn: x.entrada.usadaEn, usadaPor: x.entrada.usadaPor });
        setPantallazo(pantallazoDe(x.resultado, x.entrada ? { ...x.entrada, tipo: tipoDe(x.entrada.tipoId) } : null));
      } catch (e) {
        if (!(e instanceof SinSenal)) {
          setPantallazo({ verde: false, titulo: "No se pudo marcar", detalle: e instanceof Error ? e.message : "" });
          return;
        }
        setConSenal(false);
        if (!local) {
          setPantallazo({ verde: false, titulo: "No está en la lista", nota: "Sin señal no se puede confirmar. Si compró hace un rato, probá cuando vuelva la señal." });
          return;
        }
        const extra = { ...local, tipo: tipoDe(local.tipoId) };
        if (local.estado === "VALIDA") {
          guardarCola([...colaRef.current, { ...ingreso, entradaLocal: local.id }]);
          marcarLocal(local.id, { estado: "USADA", usadaEn: ingreso.en, usadaPor: nombre });
          setPantallazo({ ...pantallazoDe("ENTRO", extra), nota: "Sin señal: se guarda en el celular y se manda solo cuando vuelve." });
        } else {
          setPantallazo(pantallazoDe(local.estado === "USADA" ? "YA_ENTRO" : "ANULADA", extra));
        }
      }
    },
    [nombre, lista, token, marcarLocal, guardarCola, tipoDe],
  );

  // El pantallazo se va solo (verde rápido, rojo un poco más), o tocándolo.
  useEffect(() => {
    if (!pantallazo) return;
    const t = window.setTimeout(() => setPantallazo(null), pantallazo.verde ? 2200 : 4500);
    return () => window.clearTimeout(t);
  }, [pantallazo]);

  if (linkMalo && !lista) {
    return (
      <main className="contenido">
        <section className="tarjeta">
          <h2>Link de puerta</h2>
          <p className="aviso error" role="alert">{linkMalo}</p>
        </section>
      </main>
    );
  }
  if (!nombre) return <PedirNombre alGuardar={(n) => { guardado.escribir("3t-puerta-nombre", n); setNombre(n); }} fiesta={lista?.fiesta.nombre} />;
  if (!lista) return <main className="contenido"><div className="cargando" /><p className="ayuda">Bajando la lista…</p></main>;

  const pagas = lista.entradas.filter((e) => e.estado !== "ANULADA");
  const entraron = pagas.filter((e) => e.estado === "USADA").length;

  return (
    <div className="puerta">
      <header className="puerta-cabecera">
        <div>
          <strong>{lista.fiesta.nombre}</strong>
          <span>Entraron {entraron} de {pagas.length} · marcás como {nombre}{" "}
            <button type="button" className="enlace claro" onClick={() => { guardado.escribir("3t-puerta-nombre", ""); setNombre(""); }}>cambiar</button>
          </span>
        </div>
        <span className={`senal ${conSenal ? "si" : "no"}`}>
          {conSenal ? "Con señal" : "Sin señal"}{cola.length > 0 ? ` · ${cola.length} sin mandar` : ""}
        </span>
      </header>
      {linkMalo && <p className="aviso error" role="alert">{linkMalo}</p>}
      <div className="segmentado" role="tablist" aria-label="Cómo controlar">
        <button type="button" role="tab" aria-selected={modo === "camara"} className={modo === "camara" ? "activo" : ""} onClick={() => setModo("camara")}>Escanear QR</button>
        <button type="button" role="tab" aria-selected={modo === "buscar"} className={modo === "buscar" ? "activo" : ""} onClick={() => setModo("buscar")}>Buscar a mano</button>
      </div>
      {modo === "camara" ? (
        <Camara pausada={pantallazo !== null} alLeer={(texto) => void ingresar({ codigo: texto })} />
      ) : (
        <Buscar lista={lista} tipoDe={tipoDe} alDejarPasar={(id) => void ingresar({ entradaId: id })} />
      )}
      {pantallazo && (
        <button type="button" className={`pantallazo ${pantallazo.verde ? "verde" : "rojo"}`} onClick={() => setPantallazo(null)} aria-live="assertive">
          <span className="pantallazo-icono" aria-hidden="true">{pantallazo.verde ? "✓" : "✕"}</span>
          <strong className="pantallazo-titulo">{pantallazo.titulo}</strong>
          {pantallazo.nombre && <span className="pantallazo-nombre">{pantallazo.nombre}</span>}
          {pantallazo.detalle && <span className="pantallazo-detalle">{pantallazo.detalle}</span>}
          {pantallazo.nota && <span className="pantallazo-nota">{pantallazo.nota}</span>}
          <span className="pantallazo-nota">Tocá para seguir</span>
        </button>
      )}
    </div>
  );
}

function pantallazoDe(resultado: Resultado, e: { nombre: string; dni: string; tipo: string; usadaEn: string | null; usadaPor: string | null } | null): Pantallazo {
  const detalle = e ? `${e.tipo ? `${e.tipo} · ` : ""}DNI ${formatearDni(e.dni)}` : undefined;
  switch (resultado) {
    case "ENTRO":
      return { verde: true, titulo: "Puede pasar", nombre: e?.nombre, detalle, nota: "Mirá que el DNI coincida." };
    case "YA_ENTRO":
      return { verde: false, titulo: "Ya entró", nombre: e?.nombre, detalle, nota: e?.usadaEn ? `Entró a las ${hora(e.usadaEn)}${e.usadaPor ? `, la marcó ${e.usadaPor}` : ""}.` : undefined };
    case "ANULADA":
      return { verde: false, titulo: "Entrada anulada", nombre: e?.nombre, detalle, nota: "No vale: se anuló el pago." };
    case "SIN_PAGAR":
      return { verde: false, titulo: "No está pagada", nombre: e?.nombre, detalle, nota: "Todavía no se acreditó la transferencia." };
    default:
      return { verde: false, titulo: "No es una entrada de esta fiesta", nota: "El QR no está en la lista." };
  }
}

function PedirNombre(props: { alGuardar: (nombre: string) => void; fiesta: string | undefined }) {
  const [texto, setTexto] = useState("");
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim().length >= 2) props.alGuardar(texto.trim().slice(0, 40));
  };
  return (
    <main className="contenido">
      <section className="tarjeta">
        <h2>Puerta{props.fiesta ? ` · ${props.fiesta}` : ""}</h2>
        <p className="ayuda">Escribí tu nombre: queda registrado en cada entrada que marques.</p>
        <form onSubmit={enviar}>
          <label className="campo">
            Tu nombre
            <input required minLength={2} maxLength={40} autoComplete="name" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </label>
          <button className="boton principal" type="submit">Empezar</button>
        </form>
      </section>
    </main>
  );
}

function Buscar(props: { lista: ListaPuerta; tipoDe: (id: string) => string; alDejarPasar: (entradaId: string) => void }) {
  const [texto, setTexto] = useState("");
  const encontradas = useMemo(() => {
    const q = sinAcentos(texto.trim());
    const digitos = texto.replace(/\D/g, "");
    if (q.length < 2) return [];
    return props.lista.entradas
      .filter((e) => sinAcentos(e.nombre).includes(q) || (digitos.length >= 3 && e.dni.includes(digitos)))
      .slice(0, 30);
  }, [texto, props.lista]);
  return (
    <section className="tarjeta">
      <label className="campo">
        Nombre o DNI
        <input type="search" autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej: Pérez o 40111222" />
      </label>
      {texto.trim().length >= 2 && encontradas.length === 0 && <p className="ayuda">No hay nadie con ese nombre o DNI en la lista.</p>}
      <ul className="lista">
        {encontradas.map((e) => (
          <li key={e.id}>
            <span className="datos">
              <strong>{e.nombre}</strong>
              <span>{props.tipoDe(e.tipoId)} · DNI {formatearDni(e.dni)}</span>
              {e.estado === "USADA" && e.usadaEn && <span>Entró a las {hora(e.usadaEn)}{e.usadaPor ? ` (${e.usadaPor})` : ""}</span>}
            </span>
            {e.estado === "VALIDA" ? (
              <button type="button" className="boton principal chico"
                onClick={() => window.confirm(`¿Dejar pasar a ${e.nombre}? Fijate que el DNI coincida.`) && props.alDejarPasar(e.id)}>
                Dejar pasar
              </button>
            ) : (
              <span className={`chip ${e.estado === "USADA" ? "gris" : "naranja"}`}>{e.estado === "USADA" ? "Ya entró" : "Anulada"}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Cámara ---
interface DetectorDeCodigos {
  detect: (fuente: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
type ConstructorDetector = new (opciones: { formats: string[] }) => DetectorDeCodigos;

function Camara(props: { pausada: boolean; alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pausada = useRef(props.pausada);
  pausada.current = props.pausada;
  const alLeer = useRef(props.alLeer);
  alLeer.current = props.alLeer;

  useEffect(() => {
    let activo = true;
    let flujo: MediaStream | null = null;
    let espera = 0;
    const ultimo = { texto: "", cuando: 0 };

    async function arrancar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no deja usar la cámara. Abrí el link en Chrome (Android) o Safari (iPhone), o usá «Buscar a mano».");
        return;
      }
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        setError("No hay permiso para usar la cámara. Tocá el candado al lado de la dirección, permití la cámara y recargá. Mientras, usá «Buscar a mano».");
        return;
      }
      if (!activo || !video.current) return flujo.getTracks().forEach((t) => t.stop());
      video.current.srcObject = flujo;
      await video.current.play().catch(() => undefined);

      // Android trae un lector de QR propio; en iPhone se usa una librería gratis (jsQR).
      const Detector = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const lienzo = document.createElement("canvas");
      const contexto = lienzo.getContext("2d", { willReadFrequently: true });

      const mirar = async () => {
        if (!activo) return;
        const v = video.current;
        if (v && !pausada.current && v.readyState >= 2 && v.videoWidth > 0) {
          let texto: string | null = null;
          try {
            if (detector) {
              texto = (await detector.detect(v))[0]?.rawValue ?? null;
            } else if (jsQR && contexto) {
              const escala = Math.min(1, 640 / v.videoWidth);
              lienzo.width = Math.round(v.videoWidth * escala);
              lienzo.height = Math.round(v.videoHeight * escala);
              contexto.drawImage(v, 0, 0, lienzo.width, lienzo.height);
              const imagen = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
              texto = jsQR(imagen.data, imagen.width, imagen.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          } catch {
            texto = null;
          }
          // El mismo QR frente a la cámara no se lee dos veces seguidas.
          if (texto && !(texto === ultimo.texto && Date.now() - ultimo.cuando < 6000)) {
            ultimo.texto = texto;
            ultimo.cuando = Date.now();
            if (navigator.vibrate) navigator.vibrate(80);
            alLeer.current(texto.trim());
          }
        }
        espera = window.setTimeout(() => void mirar(), 180);
      };
      void mirar();
    }
    void arrancar();
    return () => {
      activo = false;
      window.clearTimeout(espera);
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <section className="camara">
      {error ? <p className="aviso error" role="alert">{error}</p> : (
        <>
          <video ref={video} muted playsInline aria-label="Cámara" />
          <span className="mira" aria-hidden="true" />
          <p className="ayuda claro">Apuntá al QR de la entrada.</p>
        </>
      )}
    </section>
  );
}
