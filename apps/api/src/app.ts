import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ErrorAdmins, crearAdmin, datosNuevoAdminSchema, desactivarAdmin, listarAdmins } from "./admins/admins.js";
import { registrarAuditoria } from "./auditoria/auditoria.js";
import { obtenerHashDeRelleno, verificarContrasena } from "./auth/contrasenas.js";
import { buscarSesion, crearSesion, revocarSesion, type AdminEnSesion } from "./auth/sesiones.js";
import { ErrorCaja } from "./caja/libro.js";
import type { Config } from "./config.js";
import type { BaseDeDatos } from "./db/cliente.js";
import { admins } from "./db/esquema.js";

export const COOKIE_SESION = "sesion_3t";

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

function responderError(respuesta: FastifyReply, estado: number, codigo: string, mensaje: string) {
  return respuesta.status(estado).send({ error: { codigo, mensaje } });
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

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  contrasena: z.string().min(1).max(200),
});

export async function construirApp(opciones: { db: BaseDeDatos; config: Config }): Promise<FastifyInstance> {
  const { db, config } = opciones;
  const enProduccion = config.NODE_ENV === "production";

  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: enProduccion ? "info" : "debug", redact: ["req.headers.cookie"] },
    trustProxy: enProduccion,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("admin", null);

  // Identifica al admin en cada pedido a partir de la cookie de sesión.
  app.addHook("onRequest", async (peticion) => {
    const token = peticion.cookies[COOKIE_SESION];
    peticion.admin = token ? await buscarSesion(db, token) : null;
  });

  app.setErrorHandler((error, _peticion, respuesta) => {
    if (error instanceof ErrorHttp) return responderError(respuesta, error.estado, error.codigo, error.message);
    if (error instanceof ZodError) {
      return responderError(respuesta, 400, "DATOS_INVALIDOS", error.issues.map((i) => i.message).join(" "));
    }
    if (error instanceof ErrorAdmins) {
      const estado = error.codigo === "SIN_PERMISO" ? 403 : error.codigo === "NO_EXISTE" ? 404 : 409;
      return responderError(respuesta, estado, error.codigo, error.message);
    }
    if (error instanceof ErrorCaja) return responderError(respuesta, 422, "ERROR_CAJA", error.message);
    const conEstado = error as { statusCode?: number; message?: string };
    if (conEstado.statusCode === 429) {
      return responderError(respuesta, 429, "DEMASIADOS_INTENTOS", "Demasiados intentos. Esperá un minuto.");
    }
    app.log.error(error);
    return responderError(respuesta, 500, "ERROR_INTERNO", "Algo salió mal. Probá de nuevo en un rato.");
  });

  // -------------------------------------------------------------------------
  // Salud: para que el hosting sepa si la app y la base están andando.
  // -------------------------------------------------------------------------
  app.get("/salud", async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Login / logout
  // -------------------------------------------------------------------------
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (peticion, respuesta) => {
      const datos = loginSchema.parse(peticion.body);
      const [admin] = await db
        .select()
        .from(admins)
        .where(sql`lower(${admins.email}) = ${datos.email}`)
        .limit(1);

      // Si el email no existe igual verificamos contra un hash de relleno, para tardar lo mismo.
      const contrasenaOk = await verificarContrasena(admin?.hashContrasena ?? (await obtenerHashDeRelleno()), datos.contrasena);
      if (!admin || !admin.activo || !contrasenaOk) {
        await registrarAuditoria(db, { tipo: "PUBLICO", ip: peticion.ip }, {
          accion: "LOGIN_FALLIDO",
          entidad: "admin",
          entidadId: admin?.id ?? "desconocido",
          despues: { email: datos.email },
        });
        throw new ErrorHttp(401, "CREDENCIALES_INVALIDAS", "Email o contraseña incorrectos.");
      }

      const sesion = await crearSesion(db, {
        adminId: admin.id,
        dias: config.SESION_DIAS,
        ip: peticion.ip,
        navegador: peticion.headers["user-agent"],
      });
      await registrarAuditoria(db, { tipo: "ADMIN", adminId: admin.id, ip: peticion.ip }, {
        accion: "LOGIN",
        entidad: "sesion",
        entidadId: sesion.sesionId,
      });

      respuesta.setCookie(COOKIE_SESION, sesion.token, {
        httpOnly: true,
        secure: enProduccion,
        sameSite: "strict",
        path: "/",
        expires: sesion.expiraEn,
      });
      return { admin: { id: admin.id, nombre: admin.nombre, email: admin.email, rol: admin.rol } };
    },
  );

  app.post("/auth/logout", async (peticion, respuesta) => {
    const admin = requiereSesion(peticion);
    await db.transaction(async (tx) => {
      await revocarSesion(tx, admin.sesionId);
      await registrarAuditoria(tx, { tipo: "ADMIN", adminId: admin.id, ip: peticion.ip }, {
        accion: "LOGOUT",
        entidad: "sesion",
        entidadId: admin.sesionId,
      });
    });
    respuesta.clearCookie(COOKIE_SESION, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/yo", async (peticion) => {
    const admin = requiereSesion(peticion);
    return { admin: { id: admin.id, nombre: admin.nombre, email: admin.email, rol: admin.rol } };
  });

  // -------------------------------------------------------------------------
  // Administradores (solo el dueño)
  // -------------------------------------------------------------------------
  app.get("/admins", async (peticion) => {
    requiereDueno(peticion);
    return { admins: await listarAdmins(db) };
  });

  app.post("/admins", async (peticion, respuesta) => {
    const dueno = requiereDueno(peticion);
    const datos = datosNuevoAdminSchema.parse(peticion.body);
    const admin = await crearAdmin(db, { tipo: "ADMIN", adminId: dueno.id, rol: dueno.rol, ip: peticion.ip }, datos);
    return respuesta.status(201).send({ admin });
  });

  app.post("/admins/:id/desactivar", async (peticion) => {
    const dueno = requiereDueno(peticion);
    const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
    const [objetivo] = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, id)).limit(1);
    if (!objetivo) throw new ErrorHttp(404, "NO_EXISTE", "El administrador no existe.");
    const admin = await desactivarAdmin(db, { tipo: "ADMIN", adminId: dueno.id, rol: dueno.rol, ip: peticion.ip }, id);
    return { admin };
  });

  return app;
}
