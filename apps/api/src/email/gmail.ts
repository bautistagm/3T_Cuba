/**
 * Envío de emails por la API de Gmail (HTTPS), desde plantelcuba@gmail.com.
 *
 * Por qué no SMTP: el plan gratis de Render bloquea los puertos de email (25, 465, 587) desde septiembre de 2025.
 * La API de Gmail va por HTTPS (puerto 443), es gratis y permite unos 500 emails por día.
 *
 * Cómo se conecta: el dueño toca "Conectar Gmail" en Ajustes, entra con plantelcuba@gmail.com y acepta que la app
 * mande emails ("gmail.send": solo enviar, no puede leer nada). Google devuelve una clave de larga duración
 * (refresh token) que se guarda CIFRADA en la base, con una llave que sale de GOOGLE_CLIENT_SECRET (solo en Render).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { eq } from "drizzle-orm";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { parametros } from "../db/esquema.js";
import { mensajeDeCorreo, type EmailParaEnviar, type Enviador } from "./entradas.js";

type Fetch = typeof fetch;
export interface ConfigGoogle {
  clientId: string;
  clientSecret: string;
  /** La casilla que se tiene que conectar (plantelcuba@gmail.com). */
  casilla: string;
  /** Dirección pública de la app, para la vuelta desde Google. */
  urlPublica: string;
  fetch?: Fetch;
}

const PARAM_TOKEN = "gmail_refresh_cifrado";
const PARAM_ESTADO = "gmail_oauth_estado";
const ALCANCES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];
const VIGENCIA_ESTADO_MS = 15 * 60_000;

export class ErrorGmail extends Error {
  constructor(
    mensaje: string,
    readonly codigo: "NO_CONECTADO" | "OTRA_CASILLA" | "ESTADO_INVALIDO" | "GOOGLE_RECHAZO" | "ENVIO_FALLIDO",
  ) {
    super(mensaje);
    this.name = "ErrorGmail";
  }
}

export const direccionDeVuelta = (urlPublica: string) => `${urlPublica.replace(/\/$/, "")}/api/email/google/vuelta`;

// --- Cifrado de la clave (AES-256-GCM) --------------------------------------

const llave = (clientSecret: string) => createHash("sha256").update(`3t-gmail:${clientSecret}`).digest();

export function cifrar(texto: string, clientSecret: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", llave(clientSecret), iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return [iv, cifrador.getAuthTag(), datos].map((b) => b.toString("base64url")).join(".");
}

export function descifrar(guardado: string, clientSecret: string): string | null {
  try {
    const [iv, etiqueta, datos] = guardado.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !etiqueta || !datos) return null;
    const descifrador = createDecipheriv("aes-256-gcm", llave(clientSecret), iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function leer(db: Ejecutor, clave: string) {
  const [fila] = await db.select().from(parametros).where(eq(parametros.clave, clave)).limit(1);
  return fila?.valor ?? null;
}
async function guardar(db: Ejecutor, clave: string, valor: string, adminId: string | null) {
  await db
    .insert(parametros)
    .values({ clave, valor, actualizadoPorAdminId: adminId })
    .onConflictDoUpdate({ target: parametros.clave, set: { valor, actualizadoPorAdminId: adminId, actualizadoEn: new Date() } });
}

// --- Conexión (OAuth) --------------------------------------------------------

/** Arma el link a Google para conectar la casilla. El "estado" ata la vuelta a este pedido del dueño. */
export async function linkParaConectar(db: BaseDeDatos, cfg: ConfigGoogle, adminId: string): Promise<string> {
  const estado = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(estado).digest("hex");
  await guardar(db, PARAM_ESTADO, JSON.stringify({ hash, adminId, vence: Date.now() + VIGENCIA_ESTADO_MS }), adminId);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: direccionDeVuelta(cfg.urlPublica),
    response_type: "code",
    scope: ALCANCES.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: cfg.casilla,
    state: estado,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Vuelta desde Google: cambia el código por la clave, verifica que sea la casilla correcta y la guarda cifrada. */
export async function completarConexion(db: BaseDeDatos, cfg: ConfigGoogle, codigo: string, estado: string): Promise<{ adminId: string }> {
  const guardado = await leer(db, PARAM_ESTADO);
  const datos = guardado ? (JSON.parse(guardado) as { hash: string; adminId: string; vence: number }) : null;
  const hash = createHash("sha256").update(estado).digest("hex");
  if (!datos || datos.hash !== hash || datos.vence < Date.now()) {
    throw new ErrorGmail("El link para conectar Gmail venció o no es válido. Volvé a tocar «Conectar Gmail».", "ESTADO_INVALIDO");
  }
  await guardar(db, PARAM_ESTADO, JSON.stringify({ hash: "usado", adminId: datos.adminId, vence: 0 }), datos.adminId);

  const respuesta = await (cfg.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: codigo,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: direccionDeVuelta(cfg.urlPublica),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; error_description?: string };
  if (!respuesta.ok || !cuerpo.refresh_token) {
    throw new ErrorGmail(`Google no dio el permiso (${cuerpo.error_description ?? respuesta.status}).`, "GOOGLE_RECHAZO");
  }
  const email = emailDelIdToken(cuerpo.id_token);
  if (!email || email.toLowerCase() !== cfg.casilla.toLowerCase()) {
    throw new ErrorGmail(`Entraste con ${email ?? "otra cuenta"}: hay que conectar ${cfg.casilla}.`, "OTRA_CASILLA");
  }
  await guardar(db, PARAM_TOKEN, cifrar(cuerpo.refresh_token, cfg.clientSecret), datos.adminId);
  accesosEnMemoria.clear();
  return { adminId: datos.adminId };
}

/** El id_token viene directo de Google por HTTPS en esta misma respuesta: alcanza con leer su contenido. */
function emailDelIdToken(idToken: string | undefined): string | null {
  const partes = idToken?.split(".");
  if (!partes || partes.length < 2) return null;
  try {
    const contenido = JSON.parse(Buffer.from(partes[1] as string, "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return contenido.email_verified === false ? null : (contenido.email ?? null);
  } catch {
    return null;
  }
}

export async function gmailConectado(db: Ejecutor, cfg: ConfigGoogle | null): Promise<boolean> {
  if (!cfg) return false;
  const guardado = await leer(db, PARAM_TOKEN);
  return guardado !== null && descifrar(guardado, cfg.clientSecret) !== null;
}

// --- Envío -------------------------------------------------------------------

/** Claves de acceso (duran 1 hora) guardadas en memoria, por app de Google. */
const accesosEnMemoria = new Map<string, { token: string; vence: number }>();

async function tokenDeAcceso(db: BaseDeDatos, cfg: ConfigGoogle): Promise<string> {
  const enMemoria = accesosEnMemoria.get(cfg.clientId);
  if (enMemoria && enMemoria.vence > Date.now() + 60_000) return enMemoria.token;
  const guardado = await leer(db, PARAM_TOKEN);
  const refresh = guardado ? descifrar(guardado, cfg.clientSecret) : null;
  if (!refresh) throw new ErrorGmail("Gmail no está conectado. Tocá «Conectar Gmail» en Ajustes.", "NO_CONECTADO");
  const respuesta = await (cfg.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!respuesta.ok || !cuerpo.access_token) {
    if (cuerpo.error === "invalid_grant") {
      throw new ErrorGmail("Google cortó el permiso de la app (por ejemplo, si cambió la contraseña de la cuenta). Volvé a tocar «Conectar Gmail».", "NO_CONECTADO");
    }
    throw new ErrorGmail(`Google no respondió bien (${respuesta.status}).`, "ENVIO_FALLIDO");
  }
  accesosEnMemoria.set(cfg.clientId, { token: cuerpo.access_token, vence: Date.now() + (cuerpo.expires_in ?? 3000) * 1000 });
  return cuerpo.access_token;
}

/** Arma el email completo (con los QR adjuntos) en el formato que pide Gmail. */
export async function emailCrudo(email: EmailParaEnviar, desde: string): Promise<string> {
  const compositor = new MailComposer(mensajeDeCorreo(email, desde));
  const buffer = await compositor.compile().build();
  return buffer.toString("base64url");
}

export function crearEnviadorGmailApi(db: BaseDeDatos, cfg: ConfigGoogle): Enviador {
  return {
    disponible: () => gmailConectado(db, cfg),
    enviar: async (email) => {
      const acceso = await tokenDeAcceso(db, cfg);
      const respuesta = await (cfg.fetch ?? fetch)("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { authorization: `Bearer ${acceso}`, "content-type": "application/json" },
        body: JSON.stringify({ raw: await emailCrudo(email, cfg.casilla) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: { message?: string } };
        if (respuesta.status === 401) accesosEnMemoria.delete(cfg.clientId);
        throw new ErrorGmail(`Gmail no aceptó el envío (${respuesta.status}${cuerpo.error?.message ? `: ${cuerpo.error.message}` : ""}).`, "ENVIO_FALLIDO");
      }
    },
  };
}
