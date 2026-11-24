import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Ejecutor } from "../db/cliente.js";
import { admins, sesiones } from "../db/esquema.js";

export interface AdminEnSesion {
  id: string;
  nombre: string;
  email: string;
  rol: "DUENO" | "ADMIN";
  sesionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Crea una sesión y devuelve el token. El token solo existe en la cookie del celular; en la base queda su hash. */
export async function crearSesion(
  ejecutor: Ejecutor,
  datos: { adminId: string; dias: number; ip?: string | undefined; navegador?: string | undefined },
): Promise<{ token: string; sesionId: string; expiraEn: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiraEn = new Date(Date.now() + datos.dias * 24 * 60 * 60 * 1000);
  const [sesion] = await ejecutor
    .insert(sesiones)
    .values({
      adminId: datos.adminId,
      tokenHash: hashToken(token),
      expiraEn,
      ip: datos.ip ?? null,
      navegador: datos.navegador?.slice(0, 300) ?? null,
    })
    .returning({ id: sesiones.id });
  if (!sesion) throw new Error("No se pudo crear la sesión");
  return { token, sesionId: sesion.id, expiraEn };
}

/** Busca la sesión de un token: tiene que existir, no estar revocada ni vencida, y el admin tiene que estar activo. */
export async function buscarSesion(ejecutor: Ejecutor, token: string): Promise<AdminEnSesion | null> {
  const [fila] = await ejecutor
    .select({
      sesionId: sesiones.id,
      id: admins.id,
      nombre: admins.nombre,
      email: admins.email,
      rol: admins.rol,
    })
    .from(sesiones)
    .innerJoin(admins, eq(admins.id, sesiones.adminId))
    .where(
      and(
        eq(sesiones.tokenHash, hashToken(token)),
        isNull(sesiones.revocadaEn),
        gt(sesiones.expiraEn, new Date()),
        eq(admins.activo, true),
      ),
    )
    .limit(1);
  return fila ?? null;
}

export async function revocarSesion(ejecutor: Ejecutor, sesionId: string): Promise<void> {
  await ejecutor
    .update(sesiones)
    .set({ revocadaEn: new Date() })
    .where(and(eq(sesiones.id, sesionId), isNull(sesiones.revocadaEn)));
}

/**
 * Cierra todas las sesiones de un admin (por ejemplo, al desactivarlo o cambiarle la contraseña).
 * `salvo`: una sesión que queda abierta (la de quien cambia su propia contraseña).
 */
export async function revocarSesionesDeAdmin(ejecutor: Ejecutor, adminId: string, salvo?: string): Promise<void> {
  await ejecutor
    .update(sesiones)
    .set({ revocadaEn: new Date() })
    .where(and(eq(sesiones.adminId, adminId), isNull(sesiones.revocadaEn), ...(salvo ? [ne(sesiones.id, salvo)] : [])));
}
