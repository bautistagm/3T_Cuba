import { auditoria } from "../db/esquema.js";
import type { Ejecutor } from "../db/cliente.js";

export type Actor =
  | { tipo: "ADMIN"; adminId: string; ip?: string | undefined }
  | { tipo: "SISTEMA" }
  | { tipo: "PUBLICO"; ip?: string | undefined };

export interface EventoAuditoria {
  accion: string;
  entidad: string;
  entidadId: string;
  antes?: unknown;
  despues?: unknown;
}

/** Campos que nunca se guardan en la auditoría. */
const CAMPOS_SECRETOS = new Set(["hashContrasena", "contrasena", "tokenHash", "token"]);

/** Prepara un objeto para guardarlo en JSON: saca secretos y pasa bigint y fechas a texto. */
function limpiar(valor: unknown): unknown {
  if (valor === undefined) return null;
  return JSON.parse(
    JSON.stringify(valor, (clave, v: unknown) => {
      if (CAMPOS_SECRETOS.has(clave)) return "[oculto]";
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

/**
 * Registra un evento en la auditoría. Se llama dentro de la misma transacción que el cambio,
 * así no puede existir un cambio sin su registro (ni un registro de algo que no pasó).
 */
export async function registrarAuditoria(ejecutor: Ejecutor, actor: Actor, evento: EventoAuditoria): Promise<void> {
  await ejecutor.insert(auditoria).values({
    actorTipo: actor.tipo,
    actorAdminId: actor.tipo === "ADMIN" ? actor.adminId : null,
    ip: actor.tipo === "SISTEMA" ? null : (actor.ip ?? null),
    accion: evento.accion,
    entidad: evento.entidad,
    entidadId: evento.entidadId,
    antes: limpiar(evento.antes),
    despues: limpiar(evento.despues),
  });
}
