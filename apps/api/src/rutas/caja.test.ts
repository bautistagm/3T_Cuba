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
let duenoId = "";
let ip = 1;

async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.4.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}
const pedir = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  duenoId = d.id;
  await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
  cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12");
});

afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("API de caja", () => {
  it("efectivo de un admin → entrega al dueño → el dueño confirma → se ve en la caja con su nombre", async () => {
    await pedir(cookieDueno, "PUT", "/api/parametros/precio-invitado", { montoCentavos: "1500000" });
    const { sabado } = (await pedir(cookieJuan, "GET", "/api/sabados/actual")).json();
    await pedir(cookieJuan, "POST", `/api/sabados/${sabado.id}/invitados`, { medio: "EFECTIVO" });
    await pedir(cookieJuan, "POST", `/api/sabados/${sabado.id}/invitados`, { medio: "EFECTIVO" });

    const caja = (await pedir(cookieJuan, "GET", "/api/caja")).json();
    expect(caja.totalCentavos).toBe("3000000");
    expect(caja.miEfectivoCentavos).toBe("3000000");
    expect(caja.efectivo[0]).toMatchObject({ nombre: "Juan", centavos: "3000000" });

    const t = await pedir(cookieJuan, "POST", "/api/caja/traspasos", { paraAdminId: duenoId, montoCentavos: "2000000" });
    expect(t.statusCode).toBe(201);
    const pendientes = (await pedir(cookieDueno, "GET", "/api/caja")).json().traspasosPendientes;
    expect(pendientes[0]).toMatchObject({ deNombre: "Juan", paraNombre: "Bautista", montoCentavos: "2000000" });
    expect((await pedir(cookieDueno, "POST", `/api/caja/traspasos/${pendientes[0].id}/confirmar`)).statusCode).toBe(200);

    const despues = (await pedir(cookieDueno, "GET", "/api/caja")).json();
    expect(despues.efectivo.map((e: { nombre: string; centavos: string }) => `${e.nombre}:${e.centavos}`).sort()).toEqual(["Bautista:2000000", "Juan:1000000"]);
  });

  it("depósito, gasto desde la cuenta, control y movimientos", async () => {
    expect((await pedir(cookieJuan, "POST", "/api/caja/depositos", { montoCentavos: "1000000" })).statusCode).toBe(201);
    expect(
      (await pedir(cookieJuan, "POST", "/api/caja/gastos", { desde: "CUENTA", items: [{ descripcion: "Hielo", categoria: "INSUMOS", subtotalCentavos: "300000" }] })).statusCode,
    ).toBe(201);
    expect((await pedir(cookieJuan, "POST", "/api/caja/controles", { declaradoCentavos: "700000", ajustar: false })).statusCode).toBe(403);
    const control = (await pedir(cookieDueno, "POST", "/api/caja/controles", { declaradoCentavos: "700000", ajustar: false })).json().control;
    expect(control.diferenciaCentavos).toBe("0");
    const { movimientos } = (await pedir(cookieJuan, "GET", "/api/caja/movimientos")).json();
    expect(movimientos.length).toBeGreaterThanOrEqual(5);
    expect(movimientos[0]).toHaveProperty("tipo");
  });

  it("un ticket de caja sin IA configurada queda para revisar y aparece en la caja", async () => {
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
    const r = await pedir(cookieJuan, "POST", "/api/caja/tickets", { desde: "CUENTA", imagenBase64: foto });
    expect(r.json().estado).toBe("REVISAR");
    expect((await pedir(cookieJuan, "GET", "/api/caja")).json().ticketsParaRevisar).toHaveLength(1);
  });
});
