import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { registrarAuditoria, type Actor } from "../auditoria/auditoria.js";
import { LARGO_MINIMO_CONTRASENA, hashearContrasena } from "../auth/contrasenas.js";
import { revocarSesionesDeAdmin } from "../auth/sesiones.js";
import { crearCuentaEfectivo } from "../caja/cuentas.js";
import type { BaseDeDatos, Ejecutor } from "../db/cliente.js";
import { admins } from "../db/esquema.js";

export class ErrorAdmins extends Error {
  constructor(
    mensaje: string,
    readonly codigo: "YA_HAY_DUENO" | "EMAIL_EN_USO" | "SIN_PERMISO" | "NO_EXISTE" | "TOPE_ADMINS",
  ) {
    super(mensaje);
    this.name = "ErrorAdmins";
  }
}

/** Además del dueño, hasta 5 administradores activos. */
export const MAXIMO_ADMINS = 5;

export const datosNuevoAdminSchema = z.object({
  nombre: z.string().trim().min(2, "El nombre es muy corto.").max(80),
  email: z.string().trim().toLowerCase().email("El email no es válido."),
  telefono: z.string().trim().max(30).optional(),
  contrasena: z
    .string()
    .min(LARGO_MINIMO_CONTRASENA, `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`)
    .max(200),
});
export type DatosNuevoAdmin = z.infer<typeof datosNuevoAdminSchema>;

const columnasPublicas = {
  id: admins.id,
  nombre: admins.nombre,
  email: admins.email,
  telefono: admins.telefono,
  rol: admins.rol,
  activo: admins.activo,
  creadoEn: admins.creadoEn,
};

async function emailEnUso(db: Ejecutor, email: string): Promise<boolean> {
  const [fila] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(sql`lower(${admins.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return Boolean(fila);
}

/** Crea al dueño. Solo funciona una vez: si ya hay dueño, falla. */
export async function crearDueno(db: BaseDeDatos, datos: DatosNuevoAdmin) {
  const validos = datosNuevoAdminSchema.parse(datos);
  const hashContrasena = await hashearContrasena(validos.contrasena);
  return db.transaction(async (tx) => {
    const [existente] = await tx.select({ id: admins.id }).from(admins).where(eq(admins.rol, "DUENO")).limit(1);
    if (existente) throw new ErrorAdmins("Ya hay un dueño registrado.", "YA_HAY_DUENO");
    if (await emailEnUso(tx, validos.email)) throw new ErrorAdmins("Ese email ya está en uso.", "EMAIL_EN_USO");

    const [dueno] = await tx
      .insert(admins)
      .values({
        nombre: validos.nombre,
        email: validos.email,
        telefono: validos.telefono ?? null,
        rol: "DUENO",
        hashContrasena,
      })
      .returning(columnasPublicas);
    if (!dueno) throw new Error("No se pudo crear el dueño");
    await crearCuentaEfectivo(tx, dueno);
    await registrarAuditoria(tx, { tipo: "SISTEMA" }, {
      accion: "ADMIN_DUENO_CREADO",
      entidad: "admin",
      entidadId: dueno.id,
      despues: dueno,
    });
    return dueno;
  });
}

/** El dueño da de alta a un administrador. */
export async function crearAdmin(
  db: BaseDeDatos,
  actor: Extract<Actor, { tipo: "ADMIN" }> & { rol: "DUENO" | "ADMIN" },
  datos: DatosNuevoAdmin,
) {
  if (actor.rol !== "DUENO") throw new ErrorAdmins("Solo el dueño puede agregar administradores.", "SIN_PERMISO");
  const validos = datosNuevoAdminSchema.parse(datos);
  const hashContrasena = await hashearContrasena(validos.contrasena);
  return db.transaction(async (tx) => {
    const [conteo] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(admins)
      .where(sql`${admins.rol} = 'ADMIN' AND ${admins.activo}`);
    if ((conteo?.total ?? 0) >= MAXIMO_ADMINS) {
      throw new ErrorAdmins(`Ya hay ${MAXIMO_ADMINS} administradores activos.`, "TOPE_ADMINS");
    }
    if (await emailEnUso(tx, validos.email)) throw new ErrorAdmins("Ese email ya está en uso.", "EMAIL_EN_USO");

    const [admin] = await tx
      .insert(admins)
      .values({
        nombre: validos.nombre,
        email: validos.email,
        telefono: validos.telefono ?? null,
        rol: "ADMIN",
        hashContrasena,
      })
      .returning(columnasPublicas);
    if (!admin) throw new Error("No se pudo crear el administrador");
    await crearCuentaEfectivo(tx, admin);
    await registrarAuditoria(tx, actor, { accion: "ADMIN_CREADO", entidad: "admin", entidadId: admin.id, despues: admin });
    return admin;
  });
}

/** El dueño desactiva a un administrador: no puede entrar más y se cierran sus sesiones. Su historial queda. */
export async function desactivarAdmin(
  db: BaseDeDatos,
  actor: Extract<Actor, { tipo: "ADMIN" }> & { rol: "DUENO" | "ADMIN" },
  adminId: string,
) {
  if (actor.rol !== "DUENO") throw new ErrorAdmins("Solo el dueño puede desactivar administradores.", "SIN_PERMISO");
  return db.transaction(async (tx) => {
    const [antes] = await tx.select(columnasPublicas).from(admins).where(eq(admins.id, adminId)).for("update");
    if (!antes || antes.rol !== "ADMIN") throw new ErrorAdmins("El administrador no existe.", "NO_EXISTE");
    const [despues] = await tx.update(admins).set({ activo: false }).where(eq(admins.id, adminId)).returning(columnasPublicas);
    await revocarSesionesDeAdmin(tx, adminId);
    await registrarAuditoria(tx, actor, { accion: "ADMIN_DESACTIVADO", entidad: "admin", entidadId: adminId, antes, despues });
    return despues;
  });
}

export async function listarAdmins(db: BaseDeDatos) {
  return db.select(columnasPublicas).from(admins).orderBy(admins.creadoEn);
}
