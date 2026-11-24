/**
 * Emails con las entradas (etapa 9.2).
 *
 * Cuando una compra se paga, se anota una notificación PENDIENTE dentro de la misma transacción.
 * Después `enviarPendientes` las manda desde plantelcuba@gmail.com (SMTP de Gmail, gratis, con una
 * contraseña de aplicación). Si falla, reintenta más tarde (hasta 6 veces, cada vez esperando más).
 */
import QRCode from "qrcode";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { formatearDni, formatearPesos } from "@3t/shared";
import type { BaseDeDatos, Transaccion } from "../db/cliente.js";
import { comprasEntradas, entradas, fiestas, notificaciones, tiposEntrada } from "../db/esquema.js";

export interface EmailParaEnviar {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  adjuntos: { nombre: string; contenido: Buffer; cid: string }[];
}
/** Quien manda los emails (la API de Gmail, o uno de mentira en los tests). */
export interface Enviador {
  /** Si está listo para mandar (por ejemplo, si Gmail ya se conectó). Si no, los emails esperan. */
  disponible: () => Promise<boolean>;
  enviar: (email: EmailParaEnviar) => Promise<void>;
}

/** El mensaje tal como lo recibe la librería de envío (separado para poder probarlo sin mandar nada). */
export function mensajeDeCorreo(email: EmailParaEnviar, desde: string) {
  return {
    from: { name: "Plantel CUBA – 3T", address: desde },
    to: email.para,
    subject: email.asunto,
    html: email.html,
    text: email.texto,
    attachments: email.adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido, cid: a.cid, contentType: "image/png" })),
  };
}

const ESPERAS_MIN = [1, 5, 15, 60, 180];
export const MAXIMO_INTENTOS = ESPERAS_MIN.length + 1;

/** Anota el email de las entradas de una compra (dentro de la transacción que la confirma). */
export async function anotarEmailDeEntradas(tx: Transaccion, compraId: string, destinatario: string) {
  await tx.insert(notificaciones).values({ tipo: "ENTRADAS", compraId, destinatario });
}

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fechaFiesta = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(d);

/** Arma el email de una compra pagada: un QR por entrada (como imagen adjunta) y el link a "mi entrada". */
export async function armarEmailDeEntradas(db: BaseDeDatos, compraId: string, urlPublica: string): Promise<EmailParaEnviar | null> {
  const [fila] = await db
    .select({ compra: comprasEntradas, fiesta: fiestas, tipo: tiposEntrada.nombre })
    .from(comprasEntradas)
    .innerJoin(fiestas, eq(fiestas.id, comprasEntradas.fiestaId))
    .innerJoin(tiposEntrada, eq(tiposEntrada.id, comprasEntradas.tipoId))
    .where(eq(comprasEntradas.id, compraId))
    .limit(1);
  if (!fila || fila.compra.estado !== "PAGADA") return null;
  const lista = (await db.select().from(entradas).where(eq(entradas.compraId, compraId)).orderBy(asc(entradas.creadoEn))).filter(
    (e) => e.estado === "VALIDA" || e.estado === "USADA",
  );
  if (lista.length === 0) return null;

  const { fiesta, compra, tipo } = fila;
  const cuando = fechaFiesta(fiesta.fechaHora);
  const link = `${urlPublica.replace(/\/$/, "")}/mi-entrada/${compra.codigoConsulta}`;
  const adjuntos = await Promise.all(
    lista.map(async (e, i) => ({
      nombre: `entrada-${i + 1}.png`,
      contenido: await QRCode.toBuffer(e.codigo, { type: "png", width: 480, margin: 2, errorCorrectionLevel: "M" }),
      cid: `qr-${i + 1}@3t`,
    })),
  );
  const bloques = lista
    .map(
      (e, i) => `
      <div style="border:1px solid #ddd;border-radius:12px;padding:16px;margin:16px 0;text-align:center">
        <div style="font-size:18px;font-weight:bold">${escapar(e.nombre)}</div>
        <div style="color:#555">DNI ${formatearDni(e.dni)} · Entrada ${escapar(tipo)}</div>
        <img src="cid:qr-${i + 1}@3t" alt="QR de la entrada" width="240" height="240" style="margin-top:12px" />
      </div>`,
    )
    .join("");
  const titulo = `${lista.length === 1 ? "Tu entrada" : "Tus entradas"} para ${fiesta.nombre}`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:16px;color:#111">
    <h1 style="font-size:22px">${escapar(titulo)}</h1>
    <p>${escapar(cuando)}${fiesta.lugar ? ` · ${escapar(fiesta.lugar)}` : ""}</p>
    <p>Pagaste ${formatearPesos(compra.totalCentavos)}. En la puerta mostrá el QR <strong>junto con tu DNI</strong>. Cada QR entra una sola vez.</p>
    ${bloques}
    <p>Si no ves los QR, abrí este link: <a href="${link}">${link}</a></p>
    <p style="color:#777;font-size:12px">Plantel CUBA · Este email lo manda la app del tercer tiempo. No respondas a este mensaje.</p>
  </body></html>`;
  const texto = [
    titulo,
    cuando,
    "",
    ...lista.map((e) => `- ${e.nombre} (DNI ${formatearDni(e.dni)}) · Entrada ${tipo}`),
    "",
    `Mostrá el QR junto con tu DNI en la puerta. Tus QR: ${link}`,
  ].join("\n");
  return { para: compra.email, asunto: titulo, html, texto, adjuntos };
}

let enviando: Promise<{ enviadas: number; fallidas: number }> | null = null;

/** Manda los emails pendientes (si hay uno en curso, espera ese). Nunca tira error: anota el problema y reintenta. */
export function enviarPendientes(db: BaseDeDatos, enviador: Enviador | null, urlPublica: string, ahora = new Date()) {
  if (!enviador) return Promise.resolve({ enviadas: 0, fallidas: 0 });
  if (enviando) return enviando;
  enviando = (async () => {
    if (!(await enviador.disponible())) return { enviadas: 0, fallidas: 0 };
    return enviarPendientesSinRepetir(db, enviador, urlPublica, ahora);
  })().finally(() => {
    enviando = null;
  });
  return enviando;
}

async function enviarPendientesSinRepetir(db: BaseDeDatos, enviador: Enviador, urlPublica: string, ahora: Date) {
  const pendientes = await db
    .select()
    .from(notificaciones)
    // Un segundo de margen: la base guarda microsegundos y JavaScript milisegundos.
    .where(and(eq(notificaciones.estado, "PENDIENTE"), lte(notificaciones.proximoIntento, new Date(ahora.getTime() + 1000))))
    .orderBy(asc(notificaciones.creadoEn))
    .limit(20);
  let enviadas = 0;
  let fallidas = 0;
  for (const n of pendientes) {
    try {
      const email = n.compraId ? await armarEmailDeEntradas(db, n.compraId, urlPublica) : null;
      if (!email) {
        // La compra se anuló antes de mandar el email: no hay nada que mandar.
        await db.update(notificaciones).set({ estado: "FALLIDA", ultimoError: "La compra ya no está pagada." }).where(eq(notificaciones.id, n.id));
        continue;
      }
      await enviador.enviar({ ...email, para: n.destinatario });
      await db.update(notificaciones).set({ estado: "ENVIADA", enviadaEn: new Date(), intentos: n.intentos + 1, ultimoError: null }).where(eq(notificaciones.id, n.id));
      enviadas++;
    } catch (error) {
      const intentos = n.intentos + 1;
      const espera = ESPERAS_MIN[intentos - 1];
      const mensaje = error instanceof Error ? error.message.slice(0, 300) : "Error desconocido";
      await db
        .update(notificaciones)
        .set({
          intentos,
          ultimoError: mensaje,
          estado: espera === undefined ? "FALLIDA" : "PENDIENTE",
          proximoIntento: new Date(ahora.getTime() + (espera ?? 0) * 60_000),
        })
        .where(eq(notificaciones.id, n.id));
      fallidas++;
    }
  }
  return { enviadas, fallidas };
}

/** Estado del último email de cada compra de una fiesta (para mostrar en la lista). */
export async function estadoEmailsDeCompras(db: BaseDeDatos, compraIds: string[]) {
  if (compraIds.length === 0) return new Map<string, { estado: string; error: string | null; enviadaEn: string | null }>();
  const filas = await db
    .select()
    .from(notificaciones)
    .where(inArray(notificaciones.compraId, compraIds))
    .orderBy(asc(notificaciones.creadoEn));
  const mapa = new Map<string, { estado: string; error: string | null; enviadaEn: string | null }>();
  for (const f of filas) if (f.compraId) mapa.set(f.compraId, { estado: f.estado, error: f.ultimoError, enviadaEn: f.enviadaEn?.toISOString() ?? null });
  return mapa;
}

/** Reenviar (el dueño): anota otro email, opcionalmente a otra dirección. */
export async function reenviarEntradas(db: BaseDeDatos, compraId: string, otroEmail?: string) {
  const [compra] = await db.select().from(comprasEntradas).where(eq(comprasEntradas.id, compraId)).limit(1);
  if (!compra) return null;
  if (compra.estado !== "PAGADA") return "NO_PAGADA" as const;
  await db.insert(notificaciones).values({ tipo: "ENTRADAS", compraId, destinatario: otroEmail ?? compra.email });
  return "ANOTADO" as const;
}
