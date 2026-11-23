import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";
import { consultarMercadoPago, direccionPermitida, ErrorMercadoPago, importeACentavos } from "./cliente.js";
import { probarConexion } from "./prueba.js";

type Pedido = { url: string; metodo: string; autorizacion: string | null };

/** Un Mercado Pago de mentira que anota cada pedido que le llega. */
function mercadoPagoFalso(pagos: unknown[], opciones: { estado?: number } = {}) {
  const pedidos: Pedido[] = [];
  const falso: typeof fetch = async (entrada, init) => {
    const url = String(entrada);
    pedidos.push({ url, metodo: init?.method ?? "GET", autorizacion: new Headers(init?.headers).get("Authorization") });
    if (opciones.estado) return new Response("{}", { status: opciones.estado });
    if (url.endsWith("/users/me")) return Response.json({ id: 111, nickname: "BAUTI" });
    return Response.json({ results: pagos, paging: { total: pagos.length } });
  };
  return { falso, pedidos };
}

const transferenciaEntrante = {
  id: 9001,
  date_created: "2026-11-23T15:00:00.000-03:00",
  date_approved: "2026-11-23T15:00:01.000-03:00",
  status: "approved",
  operation_type: "money_transfer",
  payment_type_id: "bank_transfer",
  payment_method_id: "cvu",
  transaction_amount: 1,
  collector_id: 111,
  payer: { id: 222, first_name: "Juan", last_name: "Pérez", identification: { type: "CUIL", number: "20123456789" } },
  transaction_details: { transaction_id: "ABC-123" },
};
const pagoQueHiceYo = { ...transferenciaEntrante, id: 9002, collector_id: 333, payer: { id: 111 } };

describe("conexión con Mercado Pago: solo lectura", () => {
  it("solo permite direcciones de consulta", () => {
    expect(direccionPermitida("/users/me")).toBe(true);
    expect(direccionPermitida("/v1/payments/search?limit=30&begin_date=NOW-7DAYS")).toBe(true);
    for (const prohibida of [
      "/v1/payouts",
      "/v1/transaction-intents/process",
      "/v1/payments",
      "/v1/payments/123/refunds",
      "/v1/payments/search/../../payouts",
      "/v1/payments/search?x=1#/v1/payouts",
      "/users/me/../../v1/payouts",
      "//evil.com/users/me",
    ]) {
      expect(direccionPermitida(prohibida), prohibida).toBe(false);
    }
  });

  it("rechaza una dirección prohibida sin llegar a salir", async () => {
    const { falso, pedidos } = mercadoPagoFalso([]);
    await expect(consultarMercadoPago("clave-de-prueba", "/v1/payouts", { fetch: falso })).rejects.toMatchObject({
      codigo: "DIRECCION_PROHIBIDA",
    });
    expect(pedidos).toHaveLength(0);
  });

  it("todo pedido sale como GET, a Mercado Pago y con la clave", async () => {
    const { falso, pedidos } = mercadoPagoFalso([transferenciaEntrante]);
    await probarConexion("clave-de-prueba", { fetch: falso });
    expect(pedidos.length).toBeGreaterThan(0);
    for (const p of pedidos) {
      expect(p.metodo).toBe("GET");
      expect(p.url.startsWith("https://api.mercadopago.com/")).toBe(true);
      expect(p.autorizacion).toBe("Bearer clave-de-prueba");
    }
  });

  it("convierte importes a centavos sin decimales", () => {
    expect(importeACentavos(1)).toBe(100n);
    expect(importeACentavos(1500.5)).toBe(150050n);
    expect(importeACentavos("2500.75")).toBe(250075n);
    expect(importeACentavos(-10)).toBe(-1000n);
    expect(importeACentavos(1.234)).toBeNull();
    expect(importeACentavos("abc")).toBeNull();
    expect(importeACentavos(undefined)).toBeNull();
  });

  it("la prueba muestra solo lo que entró, con sus datos para cruzar", async () => {
    const { falso } = mercadoPagoFalso([transferenciaEntrante, pagoQueHiceYo]);
    const r = await probarConexion("clave-de-prueba", { fetch: falso });
    expect(r.cuenta).toEqual({ id: "111", apodo: "BAUTI" });
    expect(r.movimientos).toHaveLength(1);
    expect(r.movimientos[0]).toMatchObject({ id: "9001", montoCentavos: 100n, medio: "bank_transfer / cvu" });
    expect(r.movimientos[0]?.referencias).toContainEqual({ campo: "transaction_details.transaction_id", valor: "ABC-123" });
    expect(r.movimientos[0]?.pagador).toContainEqual({ campo: "payer.identification.number", valor: "20123456789" });
  });

  it("sin clave o con clave rechazada avisa claro", async () => {
    await expect(probarConexion(undefined)).rejects.toMatchObject({ codigo: "SIN_CLAVE" });
    const { falso } = mercadoPagoFalso([], { estado: 401 });
    await expect(probarConexion("clave-vencida", { fetch: falso })).rejects.toBeInstanceOf(ErrorMercadoPago);
    await expect(probarConexion("clave-vencida", { fetch: falso })).rejects.toMatchObject({ codigo: "CLAVE_INVALIDA" });
  });
});

describe("API: prueba de conexión", () => {
  let conexion: ConexionBase;
  let app: FastifyInstance;
  let cookieDueno = "";
  let cookieJuan = "";
  let ip = 1;
  const entrar = async (email: string, contrasena: string) => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.6.0.${ip++}` });
    return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
  };

  beforeAll(async () => {
    conexion = await prepararBaseLimpia();
    const { falso } = mercadoPagoFalso([transferenciaEntrante]);
    app = await construirApp({
      db: conexion.db,
      config: { ...configDePrueba, MP_ACCESS_TOKEN: "clave-de-prueba" },
      fetchMercadoPago: falso,
    });
    const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
    await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
    cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
    cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12");
  });
  afterAll(async () => {
    await app.close();
    await conexion.cerrar();
  });

  it("el dueño la ve; un admin no", async () => {
    const dueno = await app.inject({ method: "GET", url: "/api/mercadopago/prueba", headers: { cookie: cookieDueno } });
    expect(dueno.statusCode).toBe(200);
    expect(dueno.json().movimientos[0]).toMatchObject({ id: "9001", montoCentavos: "100" });
    const juan = await app.inject({ method: "GET", url: "/api/mercadopago/prueba", headers: { cookie: cookieJuan } });
    expect(juan.statusCode).toBe(403);
  });
});
