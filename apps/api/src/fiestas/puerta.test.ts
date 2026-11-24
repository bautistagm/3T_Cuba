import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDueno } from "../admins/admins.js";
import { construirApp } from "../app.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { entradas } from "../db/esquema.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";
import { anularPago } from "../sabados/sabados.js";
import { fijarFechaCorte, leerCuenta } from "../verificacion/transferencias.js";
import { crearCompra, crearFiesta, detalleFiesta, nuevoLinkDePuerta } from "./fiestas.js";
import { huella, listaDePuerta, registrarIngresos } from "./puerta.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let puerta = "";
let fiestaId = "";
let venta = "";
let n = 5000;
const publico = { tipo: "PUBLICO" as const };
const pagar = async (dni: string, pesos: number) => {
  const cuenta = [{ mpPagoId: String(++n), e2eId: null, montoCentavos: BigInt(pesos) * 100n, fecha: new Date(Date.now() - 60_000), cuitPagador: `27${dni}4` }];
  await leerCuenta(conexion.db, async () => cuenta, {});
};
const entradaDe = async (dni: string) => {
  const [e] = await conexion.db.select().from(entradas).where(eq(entradas.dni, dni));
  return e as typeof entradas.$inferSelect;
};
const ingreso = (datos: { codigo?: string; entradaId?: string }, por = "Tomás", en = new Date()) => ({ id: randomUUID(), por, en, ...datos });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  await fijarFechaCorte(conexion.db, dueno, "2026-01-01");
  const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta", fechaHora: new Date(Date.now() + 86_400_000), tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }] });
  fiestaId = f.id;
  const detalle = await detalleFiesta(conexion.db, f.id, dueno);
  puerta = detalle.fiesta.tokenPuerta ?? "";
  venta = detalle.tipos[0]?.tokenVenta ?? "";
  await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }, { nombre: "Bea Gómez", dni: "41222333" }], email: "ana@ejemplo.com" });
  await pagar("40111222", 20000);
  await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Caro Sin Pagar", dni: "42333444" }], email: "caro@ejemplo.com" });
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("puerta de la fiesta", () => {
  it("la lista trae las entradas pagadas con la huella del QR, no el código", async () => {
    const lista = await listaDePuerta(conexion.db, puerta);
    expect(lista.entradas.map((e) => e.nombre)).toEqual(["Ana Pérez", "Bea Gómez"]); // la que no pagó no está
    const ana = await entradaDe("40111222");
    expect(lista.entradas[0]).toMatchObject({ huella: huella(ana.codigo), estado: "VALIDA", tipoId: lista.tipos[0]?.id });
    expect(JSON.stringify(lista)).not.toContain(ana.codigo);
    await expect(listaDePuerta(conexion.db, "link-inventado-123")).rejects.toMatchObject({ codigo: "LINK_INVALIDO" });
  });

  it("el QR entra una sola vez; la segunda vez dice cuándo y quién la marcó", async () => {
    const ana = await entradaDe("40111222");
    const primero = ingreso({ codigo: ana.codigo }, "Tomás");
    const r1 = await registrarIngresos(conexion.db, publico, puerta, { ingresos: [primero] });
    expect(r1.resultados[0]).toMatchObject({ resultado: "ENTRO", entrada: { nombre: "Ana Pérez", usadaPor: "Tomás" } });
    // El mismo celular reintenta (mala señal): no es un segundo ingreso.
    expect((await registrarIngresos(conexion.db, publico, puerta, { ingresos: [primero] })).resultados[0]?.resultado).toBe("ENTRO");
    // Otro celular escanea la captura del mismo QR.
    const r2 = await registrarIngresos(conexion.db, publico, puerta, { ingresos: [ingreso({ codigo: ana.codigo }, "Juan")] });
    expect(r2.resultados[0]).toMatchObject({ resultado: "YA_ENTRO", entrada: { usadaPor: "Tomás" } });
    expect(await entradaDe("40111222")).toMatchObject({ estado: "USADA", usadaPor: "Tomás", ingresoManual: false });
  });

  it("dos celulares a la vez con la misma entrada: entra uno solo", async () => {
    const bea = await entradaDe("41222333");
    const [a, b] = await Promise.all([
      registrarIngresos(conexion.db, publico, puerta, { ingresos: [ingreso({ entradaId: bea.id }, "Uno")] }),
      registrarIngresos(conexion.db, publico, puerta, { ingresos: [ingreso({ entradaId: bea.id }, "Dos")] }),
    ]);
    expect([a.resultados[0]?.resultado, b.resultados[0]?.resultado].sort()).toEqual(["ENTRO", "YA_ENTRO"]);
    expect((await entradaDe("41222333")).ingresoManual).toBe(true);
  });

  it("sin pagar, anulada, inventada o de otra fiesta: no entra", async () => {
    const caro = await entradaDe("42333444");
    const otra = await crearFiesta(conexion.db, dueno, { nombre: "Otra", fechaHora: new Date(Date.now() + 86_400_000), tipos: [{ nombre: "Hombre", precioCentavos: 500000n }] });
    const puertaOtra = (await detalleFiesta(conexion.db, otra.id, dueno)).fiesta.tokenPuerta ?? "";
    const r = await registrarIngresos(conexion.db, publico, puerta, {
      ingresos: [ingreso({ codigo: caro.codigo }), ingreso({ codigo: "codigo-que-no-existe-123" })],
    });
    expect(r.resultados.map((x) => x.resultado)).toEqual(["SIN_PAGAR", "NO_EXISTE"]);
    // Una entrada de esta fiesta no entra por la puerta de otra.
    const ana = await entradaDe("40111222");
    expect((await registrarIngresos(conexion.db, publico, puertaOtra, { ingresos: [ingreso({ codigo: ana.codigo })] })).resultados[0]?.resultado).toBe("NO_EXISTE");

    // Anulada: se paga y se anula el pago.
    await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Dani Anulada", dni: "43444555" }], email: "d@ejemplo.com" });
    await pagar("43444555", 10000);
    const dani = await entradaDe("43444555");
    const [fila] = (await conexion.db.execute(sql`select pago_id from compras_entradas where dni_pagador = '43444555'`)).rows as { pago_id: string }[];
    await anularPago(conexion.db, dueno, fila?.pago_id ?? "", "Se devolvió la plata");
    expect((await registrarIngresos(conexion.db, publico, puerta, { ingresos: [ingreso({ codigo: dani.codigo })] })).resultados[0]?.resultado).toBe("ANULADA");
  });

  it("la hora del celular se respeta si es razonable (marcó sin señal)", async () => {
    await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Eva Luna", dni: "44555666" }, { nombre: "Fede Sol", dni: "45666777" }], email: "e@ejemplo.com" });
    await pagar("44555666", 20000);
    const antes = new Date(Date.now() - 20 * 60_000);
    const futuro = new Date(Date.now() + 3600_000);
    await registrarIngresos(conexion.db, publico, puerta, {
      ingresos: [ingreso({ codigo: (await entradaDe("44555666")).codigo }, "Tomás", antes), ingreso({ codigo: (await entradaDe("45666777")).codigo }, "Tomás", futuro)],
    });
    expect((await entradaDe("44555666")).usadaEn?.getTime()).toBe(antes.getTime());
    expect((await entradaDe("45666777")).usadaEn?.getTime()).toBeLessThan(futuro.getTime());
  });

  it("la base no deja cambiar un ingreso ni hacer entrar una entrada sin pagar", async () => {
    await expect(conexion.db.update(entradas).set({ usadaPor: "Otro" }).where(eq(entradas.dni, "40111222"))).rejects.toThrow();
    await expect(conexion.db.update(entradas).set({ estado: "USADA", usadaEn: new Date() }).where(eq(entradas.dni, "42333444"))).rejects.toThrow();
  });

  it("si el dueño cambia el link, el viejo deja de andar", async () => {
    const viejo = puerta;
    await nuevoLinkDePuerta(conexion.db, dueno, fiestaId);
    await expect(listaDePuerta(conexion.db, viejo)).rejects.toMatchObject({ codigo: "LINK_INVALIDO" });
    puerta = (await detalleFiesta(conexion.db, fiestaId, dueno)).fiesta.tokenPuerta ?? "";
  });
});

describe("API de la puerta", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await construirApp({ db: conexion.db, config: configDePrueba });
  });
  afterAll(async () => {
    await app.close();
  });

  it("anda sin usuario, con el link", async () => {
    const lista = await app.inject({ method: "GET", url: `/api/publico/puerta/${puerta}` });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().entradas.length).toBeGreaterThan(0);
    const r = await app.inject({ method: "POST", url: `/api/publico/puerta/${puerta}/ingresos`, payload: { ingresos: [{ id: randomUUID(), codigo: "codigo-que-no-existe-123", por: "Tomás", en: new Date().toISOString() }] } });
    expect(r.json().resultados[0].resultado).toBe("NO_EXISTE");
    const sinNombre = await app.inject({ method: "POST", url: `/api/publico/puerta/${puerta}/ingresos`, payload: { ingresos: [{ id: randomUUID(), codigo: "codigo-que-no-existe-123", por: "", en: new Date().toISOString() }] } });
    expect(sinNombre.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/publico/puerta/link-inventado-123" })).statusCode).toBe(404);
  });
});
