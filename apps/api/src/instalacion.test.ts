import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COOKIE_SESION, construirApp } from "./app.js";
import type { ConexionBase } from "./db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "./pruebas/base.js";

let conexion: ConexionBase;
let app: FastifyInstance;
let ip = 1;
const nuevaIp = () => `10.1.0.${ip++}`;

const DATOS = { nombre: "Bautista", email: "bauti@ejemplo.com", contrasena: "clave-del-dueno-123" };

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const carpetaWeb = mkdtempSync(join(tmpdir(), "3t-web-"));
  writeFileSync(join(carpetaWeb, "index.html"), "<!doctype html><title>3T</title>");
  writeFileSync(join(carpetaWeb, "manifest.webmanifest"), "{}");
  app = await construirApp({ db: conexion.db, config: { ...configDePrueba, CARPETA_WEB: carpetaWeb } });
});

afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

function instalar(datos: Record<string, string>) {
  return app.inject({ method: "POST", url: "/api/instalacion", payload: datos, remoteAddress: nuevaIp() });
}

describe("instalación del dueño desde la web", () => {
  it("al principio avisa que falta crear el dueño", async () => {
    const r = await app.inject({ method: "GET", url: "/api/instalacion" });
    expect(r.json()).toEqual({ necesitaDueno: true, habilitada: true });
  });

  it("con un código incorrecto no deja crear el dueño", async () => {
    const r = await instalar({ ...DATOS, codigo: "adivinando-123" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.codigo).toBe("CODIGO_INCORRECTO");
  });

  it("con el código correcto crea el dueño y deja la sesión iniciada", async () => {
    const r = await instalar({ ...DATOS, codigo: configDePrueba.CODIGO_INSTALACION ?? "" });
    expect(r.statusCode).toBe(201);
    expect(r.json().admin).toMatchObject({ email: DATOS.email, rol: "DUENO" });
    const cookie = r.cookies.find((c) => c.name === COOKIE_SESION);
    expect(cookie).toBeDefined();
    const yo = await app.inject({ method: "GET", url: "/api/auth/yo", headers: { cookie: `${COOKIE_SESION}=${cookie?.value}` } });
    expect(yo.statusCode).toBe(200);
  });

  it("una vez creado el dueño, la instalación queda cerrada aunque tengan el código", async () => {
    const r = await instalar({
      nombre: "Intruso",
      email: "intruso@ejemplo.com",
      contrasena: "clave-del-intruso-1",
      codigo: configDePrueba.CODIGO_INSTALACION ?? "",
    });
    expect(r.statusCode).toBe(409);
    const estado = await app.inject({ method: "GET", url: "/api/instalacion" });
    expect(estado.json().necesitaDueno).toBe(false);
  });

  it("si el servidor no tiene código de instalación, no se puede instalar", async () => {
    const otra = await construirApp({ db: conexion.db, config: { NODE_ENV: "test", PUERTO: 0, DATABASE_URL: "postgresql://x/test", SESION_DIAS: 30, GEMINI_MODELOS: [], URL_PUBLICA: "https://3t.ejemplo.com" } });
    const r = await otra.inject({ method: "POST", url: "/api/instalacion", payload: { ...DATOS, codigo: "lo-que-sea-123" } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.codigo).toBe("INSTALACION_DESHABILITADA");
    await otra.close();
  });
});

describe("una sola dirección para pantallas y API", () => {
  it("/vivo responde sin tocar la base", async () => {
    const r = await app.inject({ method: "GET", url: "/vivo" });
    expect(r.json()).toEqual({ ok: true });
  });

  it("sirve las pantallas y cualquier ruta de la app devuelve index.html", async () => {
    for (const url of ["/", "/pagos", "/ajustes/administradores"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain("<title>3T</title>");
    }
    const manifiesto = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
    expect(manifiesto.statusCode).toBe(200);
  });

  it("una ruta de API que no existe da error JSON, no la pantalla", async () => {
    const r = await app.inject({ method: "GET", url: "/api/no-existe" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.codigo).toBe("NO_EXISTE");
  });

  it("manda encabezados de seguridad", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-frame-options"]).toBeDefined();
  });
});
