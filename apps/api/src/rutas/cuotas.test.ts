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
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.8.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}
const pedir = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
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

describe("API de cuotas", () => {
  it("abrir mes, ver quién debe, cobrar en efectivo y anular el pago", async () => {
    const j = (await pedir(cookieJuan, "POST", "/api/jugadores", { nombre: "Mateo", apellido: "Prueba", dni: "46000001" })).json().jugador;
    expect((await pedir(cookieJuan, "POST", "/api/cuotas/meses", { anio: 2027, mes: 2, montoCentavos: "3000000" })).statusCode).toBe(403);
    const abierto = await pedir(cookieDueno, "POST", "/api/cuotas/meses", { anio: 2027, mes: 2, montoCentavos: "3000000" });
    expect(abierto.statusCode).toBe(201);
    expect(abierto.json().cuotasCargadas).toBe(1);

    expect((await pedir(cookieJuan, "PUT", "/api/parametros/alias", { alias: "plantel.cuba.3t" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "PUT", "/api/parametros/alias", { alias: "plantel.cuba.3t" })).statusCode).toBe(200);

    const deben = (await pedir(cookieJuan, "GET", "/api/cuotas/deudores")).json();
    expect(deben).toMatchObject({ alias: "plantel.cuba.3t", totalCentavos: "3000000" });
    expect(deben.deudores[0].cuotas[0].mes).toBe("Febrero 2027");

    const cuotas = (await pedir(cookieJuan, "GET", `/api/jugadores/${j.id}/cuotas`)).json().cuotas;
    const cobro = await pedir(cookieJuan, "POST", `/api/jugadores/${j.id}/pagos-efectivo`, { cuotas: [cuotas[0].id] });
    expect(cobro.statusCode).toBe(201);
    expect((await pedir(cookieJuan, "GET", "/api/cuotas/meses")).json().meses[0]).toMatchObject({ pagaron: 1, deben: 0, cobradoCentavos: "3000000" });

    expect((await pedir(cookieJuan, "POST", `/api/pagos/${cobro.json().pago.id}/anular`, { motivo: "Me equivoqué de jugador" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "POST", `/api/pagos/${cobro.json().pago.id}/anular`, { motivo: "Me equivoqué de jugador" })).statusCode).toBe(200);
    expect((await pedir(cookieJuan, "GET", `/api/jugadores/${j.id}/cuotas`)).json().cuotas[0].estado).toBe("PENDIENTE");
  });
});
