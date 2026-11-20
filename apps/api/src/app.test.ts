import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ErrorAdmins, crearDueno } from "./admins/admins.js";
import { COOKIE_SESION, construirApp } from "./app.js";
import { codigoEfectivo } from "./caja/cuentas.js";
import type { ConexionBase } from "./db/cliente.js";
import { auditoria, cuentasCaja } from "./db/esquema.js";
import { configDePrueba, prepararBaseLimpia } from "./pruebas/base.js";

const DUENO = { nombre: "Bautista", email: "bautista@ejemplo.com", contrasena: "clave-del-dueno-123" };

let conexion: ConexionBase;
let app: FastifyInstance;
let ipSiguiente = 1;
/** Cada login sale de una IP distinta, para que el límite de intentos no mezcle tests. */
const nuevaIp = () => `10.0.0.${ipSiguiente++}`;

async function login(email: string, contrasena: string, ip = nuevaIp()) {
  return app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: ip });
}

async function cookieDe(email: string, contrasena: string): Promise<string> {
  const respuesta = await login(email, contrasena);
  expect(respuesta.statusCode).toBe(200);
  const cookie = respuesta.cookies.find((c) => c.name === COOKIE_SESION);
  if (!cookie) throw new Error("El login no devolvió cookie");
  return `${COOKIE_SESION}=${cookie.value}`;
}

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  await crearDueno(conexion.db, DUENO);
});

afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("salud", () => {
  it("responde que la app y la base andan", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/api/salud" });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ ok: true });
  });
});

describe("dueño", () => {
  it("hay un solo dueño: crear otro falla", async () => {
    await expect(
      crearDueno(conexion.db, { nombre: "Otro", email: "otro@ejemplo.com", contrasena: "otra-clave-123" }),
    ).rejects.toBeInstanceOf(ErrorAdmins);
  });

  it("el dueño tiene su cuenta de efectivo", async () => {
    const [dueno] = await conexion.db.select().from(cuentasCaja).where(eq(cuentasCaja.nombre, "Efectivo de Bautista"));
    expect(dueno?.tipo).toBe("ACTIVO");
  });
});

describe("login", () => {
  it("con datos correctos entra y deja una cookie segura", async () => {
    const respuesta = await login(DUENO.email, DUENO.contrasena);
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().admin).toMatchObject({ email: DUENO.email, rol: "DUENO" });
    const cookie = respuesta.cookies.find((c) => c.name === COOKIE_SESION);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
  });

  it("no distingue mayúsculas en el email", async () => {
    const respuesta = await login("BAUTISTA@Ejemplo.com", DUENO.contrasena);
    expect(respuesta.statusCode).toBe(200);
  });

  it("con contraseña incorrecta o email inexistente da el mismo mensaje (no revela qué emails existen)", async () => {
    const malaClave = await login(DUENO.email, "incorrecta-123");
    const noExiste = await login("nadie@ejemplo.com", "incorrecta-123");
    expect(malaClave.statusCode).toBe(401);
    expect(noExiste.statusCode).toBe(401);
    expect(malaClave.json()).toEqual(noExiste.json());
  });

  it("registra los intentos fallidos en la auditoría", async () => {
    await login(DUENO.email, "otra-incorrecta");
    const fallidos = await conexion.db.select().from(auditoria).where(eq(auditoria.accion, "LOGIN_FALLIDO"));
    expect(fallidos.length).toBeGreaterThan(0);
  });

  it("después de 5 intentos por minuto desde la misma IP, bloquea", async () => {
    const ip = nuevaIp();
    for (let i = 0; i < 5; i++) await login(DUENO.email, "mal", ip);
    const sexto = await login(DUENO.email, DUENO.contrasena, ip);
    expect(sexto.statusCode).toBe(429);
  });

  it("sin sesión no se puede ver nada privado", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/api/auth/yo" });
    expect(respuesta.statusCode).toBe(401);
  });

  it("una cookie inventada no sirve", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: `${COOKIE_SESION}=inventada` } });
    expect(respuesta.statusCode).toBe(401);
  });

  it("al cerrar sesión, la cookie deja de servir", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    expect((await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("administradores", () => {
  const ADMIN = { nombre: "Tomás", email: "tomas@ejemplo.com", contrasena: "clave-de-tomas-1" };

  it("el dueño agrega un admin, que recibe su cuenta de efectivo y queda en la auditoría", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    const respuesta = await app.inject({ method: "POST", url: "/api/admins", headers: { cookie }, payload: ADMIN });
    expect(respuesta.statusCode).toBe(201);
    const admin = respuesta.json().admin as { id: string; rol: string };
    expect(admin.rol).toBe("ADMIN");
    expect(JSON.stringify(respuesta.json())).not.toContain("hash");

    const [cuenta] = await conexion.db.select().from(cuentasCaja).where(eq(cuentasCaja.codigo, codigoEfectivo(admin.id)));
    expect(cuenta).toBeDefined();
    const [registro] = await conexion.db.select().from(auditoria).where(eq(auditoria.entidadId, admin.id));
    expect(registro?.accion).toBe("ADMIN_CREADO");
  });

  it("la auditoría nunca guarda contraseñas ni sus hashes", async () => {
    const todo = JSON.stringify(await conexion.db.select().from(auditoria));
    expect(todo).not.toContain("$argon2");
    expect(todo).not.toContain(ADMIN.contrasena);
    expect(todo).not.toContain(DUENO.contrasena);
  });

  it("no se puede repetir un email", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/admins",
      headers: { cookie },
      payload: { ...ADMIN, email: "TOMAS@ejemplo.com" },
    });
    expect(respuesta.statusCode).toBe(409);
  });

  it("valida los datos: contraseña corta y email inválido", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    const respuesta = await app.inject({
      method: "POST",
      url: "/api/admins",
      headers: { cookie },
      payload: { nombre: "X", email: "no-es-email", contrasena: "corta" },
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it("un admin no puede agregar admins ni ver la lista", async () => {
    const cookie = await cookieDe(ADMIN.email, ADMIN.contrasena);
    const crear = await app.inject({
      method: "POST",
      url: "/api/admins",
      headers: { cookie },
      payload: { nombre: "Juan", email: "juan@ejemplo.com", contrasena: "clave-de-juan-1" },
    });
    expect(crear.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admins", headers: { cookie } })).statusCode).toBe(403);
  });

  it("al desactivar un admin, se le cierran las sesiones y no puede volver a entrar", async () => {
    const cookieAdmin = await cookieDe(ADMIN.email, ADMIN.contrasena);
    const cookieDueno = await cookieDe(DUENO.email, DUENO.contrasena);
    const lista = await app.inject({ method: "GET", url: "/api/admins", headers: { cookie: cookieDueno } });
    const tomas = (lista.json().admins as { id: string; email: string }[]).find((a) => a.email === ADMIN.email);
    if (!tomas) throw new Error("No aparece Tomás en la lista");

    const respuesta = await app.inject({
      method: "POST",
      url: `/api/admins/${tomas.id}/desactivar`,
      headers: { cookie: cookieDueno },
    });
    expect(respuesta.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: cookieAdmin } })).statusCode).toBe(401);
    expect((await login(ADMIN.email, ADMIN.contrasena)).statusCode).toBe(401);
  });

  it("el dueño no se puede desactivar a sí mismo por esta vía", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    const yo = (await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie } })).json().admin as { id: string };
    const respuesta = await app.inject({ method: "POST", url: `/api/admins/${yo.id}/desactivar`, headers: { cookie } });
    expect(respuesta.statusCode).toBe(404);
  });

  it("hay un máximo de 5 administradores activos", async () => {
    const cookie = await cookieDe(DUENO.email, DUENO.contrasena);
    const codigos: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/admins",
        headers: { cookie },
        payload: { nombre: `Admin ${i}`, email: `admin${i}@ejemplo.com`, contrasena: "clave-segura-123" },
      });
      codigos.push(r.statusCode);
    }
    // Tomás está desactivado, así que entran 5 y el sexto rebota.
    expect(codigos).toEqual([201, 201, 201, 201, 201, 409]);
  });
});
