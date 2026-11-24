import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";

const CLAVE = "clave-de-lectura-de-prueba-123456";
let conexion: ConexionBase;
let app: FastifyInstance;
let cookieDueno = "";
let cookieJuan = "";
let ip = 1;
const pedidosMp: { url: string; metodo: string }[] = [];
const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();

/** Mercado Pago de mentira, con la misma forma que la transferencia real de prueba (datos inventados). */
const mercadoPago: typeof fetch = async (entrada, init) => {
  const url = String(entrada);
  pedidosMp.push({ url, metodo: init?.method ?? "GET" });
  if (url.endsWith("/users/me")) return Response.json({ id: 111 });
  return Response.json({
    results: [
      {
        id: 555000111,
        status: "approved",
        operation_type: "money_transfer",
        collector_id: 111,
        transaction_amount: 30000,
        date_created: haceUnaHora,
        date_approved: haceUnaHora,
        payer: { id: 222, identification: { type: "CUIL", number: "20460000015" } },
        point_of_interaction: { type: "PSP_TRANSFER", transaction_data: { e2e_id: "0aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } },
      },
    ],
  });
};

async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.9.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}
const pedir = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: { ...configDePrueba, MP_ACCESS_TOKEN: "clave-mp-de-prueba", CLAVE_LECTURA: CLAVE }, fetchMercadoPago: mercadoPago });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
  cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12");
});
afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("API de lectura de la cuenta", () => {
  it("sin la clave secreta no lee", async () => {
    expect((await app.inject({ method: "POST", url: "/api/cuenta/leer" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/cuenta/leer", headers: { "x-clave-lectura": "otra-clave-cualquiera-de-24-letras" } })).statusCode).toBe(401);
  });

  it("de punta a punta: lee la cuenta y marca la cuota de Mateo pagada por su DNI", async () => {
    const j = (await pedir(cookieJuan, "POST", "/api/jugadores", { nombre: "Mateo", apellido: "Prueba", dni: "46.000.001" })).json().jugador;
    const hoy = new Date();
    await pedir(cookieDueno, "POST", "/api/cuotas/meses", { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1, montoCentavos: "3000000" });
    expect((await pedir(cookieJuan, "PUT", "/api/cuenta/fecha-corte", { fecha: "2026-01-01" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "PUT", "/api/cuenta/fecha-corte", { fecha: "2026-01-01" })).statusCode).toBe(200);

    const r = await app.inject({ method: "POST", url: "/api/cuenta/leer", headers: { "x-clave-lectura": CLAVE } });
    expect(r.json()).toMatchObject({ estado: "LEIDA", nuevas: 1, confirmadas: 1 });
    expect(pedidosMp.every((p) => p.metodo === "GET")).toBe(true);
    expect((await pedir(cookieJuan, "GET", `/api/jugadores/${j.id}/cuotas`)).json().cuotas[0].estado).toBe("PAGADO");

    // Abrir la app enseguida no vuelve a leer.
    expect((await pedir(cookieJuan, "POST", "/api/cuenta/leer-ahora")).json().estado).toBe("RECIENTE");
    expect((await pedir(cookieJuan, "GET", "/api/cuenta/estado")).json()).toMatchObject({ fechaCorte: "2026-01-01", conectada: true, paraRevisar: 0 });
    expect((await pedir(cookieJuan, "GET", "/api/transferencias")).json().transferencias[0]).toMatchObject({ mpPagoId: "555000111", jugador: "Mateo Prueba", resolucion: "CUOTA_AUTO" });
  });
});
