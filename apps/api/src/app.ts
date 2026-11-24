import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import {
  ErrorAdmins,
  cambiarMiContrasena,
  crearAdmin,
  crearDueno,
  datosNuevoAdminSchema,
  desactivarAdmin,
  listarAdmins,
  restablecerContrasena,
} from "./admins/admins.js";
import { registrarAuditoria } from "./auditoria/auditoria.js";
import { obtenerHashDeRelleno, verificarContrasena } from "./auth/contrasenas.js";
import { buscarSesion, crearSesion, revocarSesion } from "./auth/sesiones.js";
import { ErrorCaja } from "./caja/libro.js";
import type { Config } from "./config.js";
import type { BaseDeDatos } from "./db/cliente.js";
import { admins } from "./db/esquema.js";
import { ErrorNegocio } from "./errores.js";
import { ErrorHttp, requiereDueno, requiereSesion } from "./rutas/comun.js";
import { rutasSabados } from "./rutas/sabados.js";
import { rutasTickets } from "./rutas/tickets.js";
import { rutasCaja } from "./rutas/caja.js";
import { rutasMercadoPago } from "./rutas/mercadopago.js";
import { rutasJugadores } from "./rutas/jugadores.js";
import { rutasCuotas } from "./rutas/cuotas.js";
import { rutasTransferencias } from "./rutas/transferencias.js";
import { rutasFiestas } from "./rutas/fiestas.js";
import { ErrorMercadoPago } from "./mercadopago/cliente.js";
import { buscarEntradas } from "./mercadopago/movimientos.js";
import { crearLectorComprobantesGemini, lectorComprobantesSinIa, type LectorComprobantes } from "./ia/lectorComprobantes.js";
import type { DependenciasVerificacion } from "./verificacion/comprobantes.js";
import { crearLectorGemini, lectorSinIa, type LectorTickets } from "./ia/lectorTickets.js";
import { asistenteSinIa, crearAsistenteGemini, ErrorAsistenteIa, type AsistenteIa } from "./ia/asistente.js";

export { ErrorHttp, requiereDueno, requiereSesion };

export const COOKIE_SESION = "sesion_3t";

function responderError(respuesta: FastifyReply, estado: number, codigo: string, mensaje: string) {
  return respuesta.status(estado).send({ error: { codigo, mensaje } });
}

/** Compara dos textos sin que el tiempo de respuesta revele cuántos caracteres coinciden. */
function textosIguales(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  contrasena: z.string().min(1).max(200),
});

const instalacionSchema = datosNuevoAdminSchema.extend({ codigo: z.string().min(1).max(200) });

type AdminPublico = { id: string; nombre: string; email: string; rol: "DUENO" | "ADMIN" };

export async function construirApp(opciones: {
  db: BaseDeDatos;
  config: Config;
  lectorTickets?: LectorTickets;
  asistente?: AsistenteIa;
  lectorComprobantes?: LectorComprobantes;
  /** Solo para tests: reemplaza la conexión real con Mercado Pago. */
  fetchMercadoPago?: typeof fetch;
}): Promise<FastifyInstance> {
  const { db, config } = opciones;
  const lectorTickets =
    opciones.lectorTickets ??
    (config.GEMINI_API_KEY ? crearLectorGemini({ apiKey: config.GEMINI_API_KEY, modelos: config.GEMINI_MODELOS }) : lectorSinIa);
  const asistente =
    opciones.asistente ??
    (config.GEMINI_API_KEY ? crearAsistenteGemini({ apiKey: config.GEMINI_API_KEY, modelos: config.GEMINI_MODELOS }) : asistenteSinIa);
  const lectorComprobantes =
    opciones.lectorComprobantes ??
    (config.GEMINI_API_KEY ? crearLectorComprobantesGemini({ apiKey: config.GEMINI_API_KEY, modelos: config.GEMINI_MODELOS }) : lectorComprobantesSinIa);
  const claveMp = config.MP_ACCESS_TOKEN;
  const fetchMp = opciones.fetchMercadoPago;
  const verificacion: DependenciasVerificacion = {
    lector: lectorComprobantes,
    buscarEntradas: claveMp ? (desde, hasta) => buscarEntradas(claveMp, desde, hasta, fetchMp ? { fetch: fetchMp } : {}) : null,
  };
  const enProduccion = config.NODE_ENV === "production";

  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: enProduccion ? "info" : "debug", redact: ["req.headers.cookie", 'req.headers["x-clave-lectura"]'] },
    trustProxy: enProduccion,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // El escudo y las fotos se muestran desde la misma app; el service worker de la PWA también.
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'"],
        "manifest-src": ["'self'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest("admin", null);

  // Los montos son bigint (centavos): viajan como texto para no perder precisión.
  app.setReplySerializer((carga) =>
    JSON.stringify(carga, (_clave, valor: unknown) => (typeof valor === "bigint" ? valor.toString() : valor)),
  );

  app.setErrorHandler((error, _peticion, respuesta) => {
    if (error instanceof ErrorHttp) return responderError(respuesta, error.estado, error.codigo, error.message);
    if (error instanceof ZodError) {
      return responderError(respuesta, 400, "DATOS_INVALIDOS", error.issues.map((i) => i.message).join(" "));
    }
    if (error instanceof ErrorAdmins) {
      const estado = error.codigo === "SIN_PERMISO" ? 403 : error.codigo === "NO_EXISTE" ? 404 : error.codigo === "CONTRASENA_INCORRECTA" ? 400 : 409;
      return responderError(respuesta, estado, error.codigo, error.message);
    }
    if (error instanceof ErrorNegocio) return responderError(respuesta, error.estado, error.codigo, error.message);
    if (error instanceof ErrorCaja) return responderError(respuesta, 422, "ERROR_CAJA", error.message);
    if (error instanceof ErrorMercadoPago) {
      const estado = error.codigo === "SIN_CLAVE" ? 409 : error.codigo === "DIRECCION_PROHIBIDA" ? 500 : 502;
      return responderError(respuesta, estado, `MP_${error.codigo}`, error.message);
    }
    if (error instanceof ErrorAsistenteIa) return responderError(respuesta, 503, "IA_NO_DISPONIBLE", error.message);
    const conEstado = error as { statusCode?: number };
    if (conEstado.statusCode === 429) {
      return responderError(respuesta, 429, "DEMASIADOS_INTENTOS", "Demasiados intentos. Esperá un minuto.");
    }
    if (conEstado.statusCode === 400) {
      return responderError(respuesta, 400, "DATOS_INVALIDOS", "Los datos enviados no son válidos.");
    }
    app.log.error(error);
    return responderError(respuesta, 500, "ERROR_INTERNO", "Algo salió mal. Probá de nuevo en un rato.");
  });

  // Para el aviso que mantiene despierta la app. No toca la base, así no gasta sus horas gratis.
  app.get("/vivo", async () => ({ ok: true }));

  async function iniciarSesion(peticion: FastifyRequest, respuesta: FastifyReply, admin: AdminPublico) {
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
  }

  // ---------------------------------------------------------------------------
  // Todo lo de la API vive bajo /api
  // ---------------------------------------------------------------------------
  await app.register(
    async (api) => {
      // Identifica al admin en cada pedido a partir de la cookie de sesión.
      api.addHook("onRequest", async (peticion) => {
        const token = peticion.cookies[COOKIE_SESION];
        peticion.admin = token ? await buscarSesion(db, token) : null;
      });

      api.get("/salud", async () => {
        await db.execute(sql`select 1`);
        return { ok: true };
      });

      // -----------------------------------------------------------------------
      // Instalación: crear la cuenta del dueño la primera vez, con el código de instalación.
      // -----------------------------------------------------------------------
      api.get("/instalacion", async () => {
        const [dueno] = await db.select({ id: admins.id }).from(admins).where(eq(admins.rol, "DUENO")).limit(1);
        return { necesitaDueno: !dueno, habilitada: Boolean(config.CODIGO_INSTALACION) };
      });

      api.post(
        "/instalacion",
        { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
        async (peticion, respuesta) => {
          const { codigo, ...datos } = instalacionSchema.parse(peticion.body);
          if (!config.CODIGO_INSTALACION) {
            throw new ErrorHttp(403, "INSTALACION_DESHABILITADA", "La instalación no está habilitada en el servidor.");
          }
          if (!textosIguales(codigo, config.CODIGO_INSTALACION)) {
            await registrarAuditoria(db, { tipo: "PUBLICO", ip: peticion.ip }, {
              accion: "INSTALACION_CODIGO_INCORRECTO",
              entidad: "admin",
              entidadId: "dueno",
            });
            throw new ErrorHttp(403, "CODIGO_INCORRECTO", "El código de instalación no es correcto.");
          }
          const dueno = await crearDueno(db, datos);
          return respuesta.status(201).send(await iniciarSesion(peticion, respuesta, dueno));
        },
      );

      // -----------------------------------------------------------------------
      // Login / logout
      // -----------------------------------------------------------------------
      api.post(
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
          const contrasenaOk = await verificarContrasena(
            admin?.hashContrasena ?? (await obtenerHashDeRelleno()),
            datos.contrasena,
          );
          if (!admin || !admin.activo || !contrasenaOk) {
            await registrarAuditoria(db, { tipo: "PUBLICO", ip: peticion.ip }, {
              accion: "LOGIN_FALLIDO",
              entidad: "admin",
              entidadId: admin?.id ?? "desconocido",
              despues: { email: datos.email },
            });
            throw new ErrorHttp(401, "CREDENCIALES_INVALIDAS", "Email o contraseña incorrectos.");
          }
          return iniciarSesion(peticion, respuesta, admin);
        },
      );

      api.post("/auth/logout", async (peticion, respuesta) => {
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

      api.post("/auth/contrasena", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (peticion) => {
        const admin = requiereSesion(peticion);
        const { actual, nueva } = z.object({ actual: z.string().min(1, "Escribí tu contraseña actual.").max(200), nueva: z.string().max(200) }).parse(peticion.body);
        await cambiarMiContrasena(db, admin.id, admin.sesionId, actual, nueva);
        return { ok: true };
      });

      api.get("/auth/yo", async (peticion) => {
        const admin = requiereSesion(peticion);
        return { admin: { id: admin.id, nombre: admin.nombre, email: admin.email, rol: admin.rol } };
      });

      // -----------------------------------------------------------------------
      // Administradores (solo el dueño)
      // -----------------------------------------------------------------------
      api.get("/admins", async (peticion) => {
        requiereDueno(peticion);
        return { admins: await listarAdmins(db) };
      });

      api.post("/admins", async (peticion, respuesta) => {
        const dueno = requiereDueno(peticion);
        const datos = datosNuevoAdminSchema.parse(peticion.body);
        const admin = await crearAdmin(db, { tipo: "ADMIN", adminId: dueno.id, rol: dueno.rol, ip: peticion.ip }, datos);
        return respuesta.status(201).send({ admin });
      });

      api.post("/admins/:id/desactivar", async (peticion) => {
        const dueno = requiereDueno(peticion);
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        const [objetivo] = await db.select({ id: admins.id }).from(admins).where(eq(admins.id, id)).limit(1);
        if (!objetivo) throw new ErrorHttp(404, "NO_EXISTE", "El administrador no existe.");
        const admin = await desactivarAdmin(db, { tipo: "ADMIN", adminId: dueno.id, rol: dueno.rol, ip: peticion.ip }, id);
        return { admin };
      });

      api.post("/admins/:id/contrasena", async (peticion) => {
        const dueno = requiereDueno(peticion);
        const { id } = z.object({ id: z.string().uuid() }).parse(peticion.params);
        const { nueva } = z.object({ nueva: z.string().max(200) }).parse(peticion.body);
        await restablecerContrasena(db, { tipo: "ADMIN", adminId: dueno.id, rol: dueno.rol, ip: peticion.ip }, id, nueva);
        return { ok: true };
      });

      rutasSabados(api, db);
      rutasTickets(api, db, lectorTickets);
      rutasCaja(api, db, lectorTickets, asistente);
      rutasJugadores(api, db);
      rutasCuotas(api, db);
      rutasFiestas(api, db, verificacion.buscarEntradas);
      rutasTransferencias(api, db, verificacion.buscarEntradas, config.CLAVE_LECTURA, config.MP_ACCESS_TOKEN !== undefined);
      rutasMercadoPago(api, db, config.MP_ACCESS_TOKEN, verificacion, opciones.fetchMercadoPago);

      api.setNotFoundHandler((_peticion, respuesta) =>
        responderError(respuesta, 404, "NO_EXISTE", "Esa dirección de la API no existe."),
      );
    },
    { prefix: "/api" },
  );

  // ---------------------------------------------------------------------------
  // Pantallas: la misma app sirve el frontend, así todo queda en una sola dirección
  // (y la cookie de sesión funciona sin abrirle la puerta a otros sitios).
  // ---------------------------------------------------------------------------
  if (config.CARPETA_WEB && existsSync(config.CARPETA_WEB)) {
    await app.register(fastifyStatic, { root: config.CARPETA_WEB, wildcard: false });
    app.setNotFoundHandler((peticion, respuesta) => {
      if (peticion.method === "GET" && !peticion.url.startsWith("/api/")) {
        return respuesta.sendFile("index.html");
      }
      return responderError(respuesta, 404, "NO_EXISTE", "No existe.");
    });
  }

  return app;
}
