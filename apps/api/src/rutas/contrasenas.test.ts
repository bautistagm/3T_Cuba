import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";

let conexion: ConexionBase;
let app: FastifyInstance;
let juanId = "";
let ip = 1;
async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.10.0.${ip++}` });
  return r.statusCode === 200 ? `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}` : null;
}
const pedir = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, remoteAddress: `10.10.1.${ip++}`, ...(payload ? { payload } : {}) });
const sigueAdentro = async (cookie: string) => (await pedir(cookie, "GET", "/api/auth/yo")).statusCode === 200;

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  juanId = (await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" })).id;
});
afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("contraseñas", () => {
  it("cada uno cambia la suya sabiendo la actual; se cierran sus otras sesiones", async () => {
    const enCelular = (await entrar("j@ejemplo.com", "clave-de-juan-12")) ?? "";
    const enCompu = (await entrar("j@ejemplo.com", "clave-de-juan-12")) ?? "";
    expect((await pedir(enCelular, "POST", "/api/auth/contrasena", { actual: "otra-cualquiera", nueva: "clave-nueva-de-juan" })).statusCode).toBe(400);
    expect((await pedir(enCelular, "POST", "/api/auth/contrasena", { actual: "clave-de-juan-12", nueva: "corta" })).statusCode).toBe(400);
    expect((await pedir(enCelular, "POST", "/api/auth/contrasena", { actual: "clave-de-juan-12", nueva: "clave-de-juan-12" })).statusCode).toBe(409);
    expect((await pedir(enCelular, "POST", "/api/auth/contrasena", { actual: "clave-de-juan-12", nueva: "clave-nueva-de-juan" })).statusCode).toBe(200);
    expect(await sigueAdentro(enCelular)).toBe(true);
    expect(await sigueAdentro(enCompu)).toBe(false);
    expect(await entrar("j@ejemplo.com", "clave-de-juan-12")).toBeNull();
    expect(await entrar("j@ejemplo.com", "clave-nueva-de-juan")).not.toBeNull();
  });

  it("el dueño restablece la de un admin que se la olvidó; el admin no puede hacerlo", async () => {
    const juan = (await entrar("j@ejemplo.com", "clave-nueva-de-juan")) ?? "";
    const dueno = (await entrar("b@ejemplo.com", "clave-del-dueno-1")) ?? "";
    expect((await pedir(juan, "POST", `/api/admins/${juanId}/contrasena`, { nueva: "otra-clave-larga-1" })).statusCode).toBe(403);
    expect((await pedir(dueno, "POST", `/api/admins/${juanId}/contrasena`, { nueva: "clave-temporal-123" })).statusCode).toBe(200);
    expect(await sigueAdentro(juan)).toBe(false);
    expect(await entrar("j@ejemplo.com", "clave-temporal-123")).not.toBeNull();
  });
});
