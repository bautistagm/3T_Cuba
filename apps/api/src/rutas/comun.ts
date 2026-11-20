import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminEnSesion } from "../auth/sesiones.js";
import type { ActorAdmin } from "../caja/libro.js";

declare module "fastify" {
  interface FastifyRequest {
    admin: AdminEnSesion | null;
  }
}

/** Error con un mensaje pensado para mostrarle a la persona. */
export class ErrorHttp extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function requiereSesion(peticion: FastifyRequest): AdminEnSesion {
  if (!peticion.admin) throw new ErrorHttp(401, "SIN_SESION", "Tenés que iniciar sesión.");
  return peticion.admin;
}

export function requiereDueno(peticion: FastifyRequest): AdminEnSesion {
  const admin = requiereSesion(peticion);
  if (admin.rol !== "DUENO") throw new ErrorHttp(403, "SOLO_DUENO", "Esto solo lo puede hacer el dueño.");
  return admin;
}

/** El admin con sesión, como "actor" para la caja y la auditoría. */
export function actorDe(peticion: FastifyRequest): ActorAdmin {
  const admin = requiereSesion(peticion);
  return { tipo: "ADMIN", adminId: admin.id, rol: admin.rol, ip: peticion.ip };
}

export const idSchema = z.object({ id: z.string().uuid("El identificador no es válido.") });

export const motivoSchema = z.object({
  motivo: z.string().trim().min(5, "Escribí el motivo (al menos 5 letras).").max(300),
});

/** Montos que llegan como texto de centavos: "1500000" = $15.000. */
export const montoSchema = z
  .string()
  .regex(/^\d{1,13}$/, "El monto no es válido.")
  .transform((t) => BigInt(t))
  .refine((n) => n > 0n, "El monto tiene que ser mayor a cero.");

export const textoOpcional = (max: number) => z.string().trim().max(max).optional();
