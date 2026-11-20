/**
 * Tickets de compra: foto → IA → gasto.
 *
 * Se registra solo si la lectura es confiable: es un ticket, se lee, tiene productos con importes válidos
 * y los productos suman exactamente el total. Cualquier duda (o una foto repetida) va a "Revisar".
 */
import { createHash } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { formatearPesos, sumarCentavos, MONTO_MAXIMO_CENTAVOS } from "@3t/shared";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import type { ActorAdmin } from "../caja/libro.js";
import { gastoDeCocinaEnTx } from "../cocina/cocina.js";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { archivos, cocinas, tickets } from "../db/esquema.js";
import { ErrorNegocio, noExiste } from "../errores.js";
import type { ItemGasto } from "../gastos/gastos.js";
import type { LecturaTicket, LectorTickets } from "../ia/lectorTickets.js";

export const TAMANO_MAXIMO_IMAGEN = 4 * 1024 * 1024;

/** Reconoce el tipo de imagen por sus primeros bytes (no confiamos en lo que dice el navegador). */
export function tipoDeImagen(contenido: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (contenido.length > 3 && contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) return "image/jpeg";
  if (contenido.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (contenido.subarray(0, 4).toString("latin1") === "RIFF" && contenido.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Decide si una lectura de la IA alcanza para registrar el gasto solo. Si no, devuelve el motivo. */
export function evaluarLectura(lectura: LecturaTicket): { ok: true; items: ItemGasto[] } | { ok: false; motivo: string } {
  if (!lectura.es_ticket) return { ok: false, motivo: "La IA dice que la foto no parece un ticket de compra." };
  if (!lectura.legible) return { ok: false, motivo: `La IA no pudo leerlo con seguridad.${lectura.observaciones ? ` ${lectura.observaciones}` : ""}` };
  if (lectura.items.length === 0) return { ok: false, motivo: "La IA no encontró productos en el ticket." };
  if (lectura.total_centavos === null) return { ok: false, motivo: "La IA no encontró el total del ticket." };
  const items: ItemGasto[] = [];
  for (const item of lectura.items) {
    const importe = BigInt(item.importe_centavos);
    if (importe <= 0n || importe > MONTO_MAXIMO_CENTAVOS) {
      return { ok: false, motivo: `El importe de "${item.descripcion}" no es válido.` };
    }
    items.push({ descripcion: item.descripcion, cantidad: item.cantidad ?? undefined, categoria: item.categoria, subtotalCentavos: importe });
  }
  const suma = sumarCentavos(items.map((i) => i.subtotalCentavos));
  const total = BigInt(lectura.total_centavos);
  if (suma !== total) {
    return { ok: false, motivo: `Los productos suman ${formatearPesos(suma)} y el total del ticket es ${formatearPesos(total)}.` };
  }
  return { ok: true, items };
}

/** Fecha del ticket si es razonable (últimos 60 días, no futura); si no, ahora. */
function fechaDelTicket(fecha: string | null): Date {
  if (!fecha) return new Date();
  const d = new Date(`${fecha}T12:00:00-03:00`);
  const ahora = Date.now();
  if (Number.isNaN(d.getTime()) || d.getTime() > ahora + 24 * 3600_000 || d.getTime() < ahora - 60 * 24 * 3600_000) return new Date();
  return d;
}

export interface ResultadoTicket {
  ticketId: string;
  estado: "REGISTRADO" | "REVISAR";
  motivoRevision: string | null;
  gastoId: string | null;
}

/** Sube la foto de un ticket de la cocina, la lee con IA y, si todo cierra, registra el gasto. */
export async function subirTicketDeCocina(
  db: BaseDeDatos,
  lector: LectorTickets,
  actor: Actor,
  datos: { cocinaId: string; contenido: Buffer },
): Promise<ResultadoTicket> {
  if (datos.contenido.length === 0) throw new ErrorNegocio(400, "IMAGEN_VACIA", "La foto está vacía.");
  if (datos.contenido.length > TAMANO_MAXIMO_IMAGEN) throw new ErrorNegocio(400, "IMAGEN_GRANDE", "La foto es demasiado grande (máximo 4 MB).");
  const tipoMime = tipoDeImagen(datos.contenido);
  if (!tipoMime) throw new ErrorNegocio(400, "NO_ES_IMAGEN", "El archivo no es una foto (JPG, PNG o WEBP).");

  const [cocina] = await db.select().from(cocinas).where(eq(cocinas.id, datos.cocinaId)).limit(1);
  if (!cocina) throw noExiste("La cocina");
  if (cocina.estado !== "ABIERTA") throw new ErrorNegocio(409, "COCINA_CERRADA", "La cocina de ese sábado ya se cerró.");

  const sha256 = createHash("sha256").update(datos.contenido).digest("hex");
  const [repetida] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(archivos, eq(archivos.id, tickets.archivoId))
    .where(and(eq(tickets.cocinaId, cocina.id), eq(archivos.sha256, sha256), ne(tickets.estado, "DESCARTADO")))
    .limit(1);

  // La IA se consulta fuera de la transacción: puede tardar y no tiene que bloquear la base.
  let lectura: LecturaTicket | null = null;
  let motivo: string | null = null;
  let items: ItemGasto[] = [];
  if (repetida) {
    motivo = "Esta misma foto ya se había subido. Revisá que no sea el mismo ticket dos veces.";
  } else {
    try {
      lectura = await lector({ contenido: datos.contenido, tipoMime });
      const evaluacion = evaluarLectura(lectura);
      if (evaluacion.ok) items = evaluacion.items;
      else motivo = evaluacion.motivo;
    } catch (error) {
      motivo = error instanceof Error ? error.message : "La IA no pudo leer el ticket.";
    }
  }

  return db.transaction(async (tx) => {
    const [archivo] = await tx
      .insert(archivos)
      .values({ tipoMime, tamanoBytes: datos.contenido.length, sha256, contenido: datos.contenido })
      .returning({ id: archivos.id });
    if (!archivo) throw new Error("No se pudo guardar la foto");

    let gastoId: string | null = null;
    if (!motivo && lectura) {
      const gasto = await gastoDeCocinaEnTx(tx, actor, {
        cocinaId: cocina.id,
        fecha: fechaDelTicket(lectura.fecha),
        proveedor: lectura.proveedor ?? undefined,
        origenCarga: "IA",
        items,
      });
      gastoId = gasto.id;
    }
    const [ticket] = await tx
      .insert(tickets)
      .values({
        cocinaId: cocina.id,
        archivoId: archivo.id,
        estado: gastoId ? "REGISTRADO" : "REVISAR",
        lecturaIa: lectura,
        motivoRevision: motivo,
        gastoId,
        subidoPorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
      })
      .returning();
    if (!ticket) throw new Error("No se pudo guardar el ticket");
    await registrarAuditoria(tx, actor, {
      accion: gastoId ? "TICKET_REGISTRADO_POR_IA" : "TICKET_PARA_REVISAR",
      entidad: "ticket",
      entidadId: ticket.id,
      despues: { cocinaId: cocina.id, gastoId, motivo, lectura },
    });
    return { ticketId: ticket.id, estado: ticket.estado === "REGISTRADO" ? "REGISTRADO" : "REVISAR", motivoRevision: motivo, gastoId };
  });
}

async function ticketParaRevisar(db: Ejecutor, ticketId: string) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw noExiste("El ticket");
  if (ticket.estado !== "REVISAR") throw new ErrorNegocio(409, "TICKET_YA_RESUELTO", "Este ticket ya se resolvió.");
  return ticket;
}

/** Un admin confirma (y corrige si hace falta) lo que leyó la IA: se registra el gasto. */
export async function resolverTicket(
  db: BaseDeDatos,
  actor: ActorAdmin,
  ticketId: string,
  datos: { proveedor?: string | undefined; items: readonly ItemGasto[] },
) {
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for("update");
    if (!ticket) throw noExiste("El ticket");
    if (ticket.estado !== "REVISAR") throw new ErrorNegocio(409, "TICKET_YA_RESUELTO", "Este ticket ya se resolvió.");
    if (!ticket.cocinaId) throw new ErrorNegocio(409, "TICKET_SIN_COCINA", "El ticket no está asociado a una cocina.");
    const gasto = await gastoDeCocinaEnTx(tx, actor, {
      cocinaId: ticket.cocinaId,
      proveedor: datos.proveedor,
      origenCarga: "MANUAL",
      items: datos.items,
    });
    await tx
      .update(tickets)
      .set({ estado: "REGISTRADO", gastoId: gasto.id, resueltoPorAdminId: actor.adminId })
      .where(eq(tickets.id, ticketId));
    await registrarAuditoria(tx, actor, { accion: "TICKET_RESUELTO", entidad: "ticket", entidadId: ticketId, despues: { gastoId: gasto.id } });
    return gasto;
  });
}

/** Un admin decide que el ticket no corresponde (repetido, no es un ticket, etc.). */
export async function descartarTicket(db: BaseDeDatos, actor: ActorAdmin, ticketId: string, motivo: string) {
  return db.transaction(async (tx) => {
    await ticketParaRevisar(tx, ticketId);
    await tx
      .update(tickets)
      .set({ estado: "DESCARTADO", motivoRevision: motivo.trim(), resueltoPorAdminId: actor.adminId })
      .where(eq(tickets.id, ticketId));
    await registrarAuditoria(tx, actor, { accion: "TICKET_DESCARTADO", entidad: "ticket", entidadId: ticketId, despues: { motivo } });
  });
}

/** Tickets de una cocina, sin la foto (la foto se pide aparte). */
export async function ticketsDeCocina(db: Ejecutor, cocinaId: string) {
  return db
    .select({
      id: tickets.id,
      estado: tickets.estado,
      motivoRevision: tickets.motivoRevision,
      lecturaIa: tickets.lecturaIa,
      gastoId: tickets.gastoId,
      subidoPorAdminId: tickets.subidoPorAdminId,
      creadoEn: tickets.creadoEn,
    })
    .from(tickets)
    .where(eq(tickets.cocinaId, cocinaId))
    .orderBy(desc(tickets.creadoEn));
}

export async function fotoDeTicket(db: Ejecutor, ticketId: string) {
  const [fila] = await db
    .select({ tipoMime: archivos.tipoMime, contenido: archivos.contenido })
    .from(tickets)
    .innerJoin(archivos, eq(archivos.id, tickets.archivoId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!fila) throw noExiste("El ticket");
  return fila;
}
