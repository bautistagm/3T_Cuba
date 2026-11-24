import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";

let conexion: ConexionBase;
let app: FastifyInstance;
let cookieDueno = "";
let cookieJuan = "";
let ip = 1;
async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.11.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}
const pedir = (cookie: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
  cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12");
});
afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("API de fiestas", () => {
  it("crear, comprar por el link público, ver el estado y descargar la lista", async () => {
    const datos = { nombre: "Fiesta de prueba", fechaHora: new Date(Date.now() + 7 * 86_400_000).toISOString(), tipos: [{ nombre: "Mujer", precioCentavos: "1000000" }, { nombre: "Hombre", precioCentavos: "1500000" }] };
    expect((await pedir(cookieJuan, "POST", "/api/fiestas", datos)).statusCode).toBe(403);
    const creada = await pedir(cookieDueno, "POST", "/api/fiestas", datos);
    expect(creada.statusCode).toBe(201);
    const detalle = (await pedir(cookieDueno, "GET", `/api/fiestas/${creada.json().fiesta.id}`)).json();
    const link = detalle.tipos[0].tokenVenta;

    // Público, sin sesión.
    const venta = await app.inject({ method: "GET", url: `/api/publico/venta/${link}` });
    expect(venta.json()).toMatchObject({ tipo: { nombre: "Mujer", precioCentavos: "1000000" }, abierta: true });
    const compra = await app.inject({ method: "POST", url: `/api/publico/venta/${link}/compras`, payload: { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }], email: "ana@ejemplo.com" } });
    expect(compra.statusCode).toBe(201);
    const estado = await app.inject({ method: "GET", url: `/api/publico/compras/${compra.json().codigoConsulta}` });
    expect(estado.json()).toMatchObject({ estado: "PENDIENTE_PAGO", totalCentavos: "1000000", tipo: "Mujer" });
    expect((await app.inject({ method: "GET", url: "/api/publico/venta/no-existe-este-link" })).statusCode).toBe(404);

    const csv = await pedir(cookieJuan, "GET", `/api/fiestas/${creada.json().fiesta.id}/lista.csv`);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("Ana Pérez");
    expect((await pedir(cookieJuan, "GET", "/api/fiestas")).json().fiestas[0]).toMatchObject({ nombre: "Fiesta de prueba", pendientes: 1 });
  });
});
