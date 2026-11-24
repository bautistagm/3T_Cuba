import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { entradas, fiestas, pagos, tiposEntrada, transferenciasRecibidas } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { fijarFechaCorte, leerCuenta } from "../verificacion/transferencias.js";
import { antesDeEliminarFiesta, eliminarFiesta } from "./eliminar.js";
import { agregarTanda, crearCompra, crearFiesta, detalleFiesta } from "./fiestas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let n = 7000;
const pagar = async (dni: string, pesos: number) => {
  const cuenta = [{ mpPagoId: String(++n), e2eId: null, montoCentavos: BigInt(pesos) * 100n, fecha: new Date(Date.now() - 60_000), cuitPagador: `27${dni}4` }];
  await leerCuenta(conexion.db, async () => cuenta, {});
  return String(n);
};
const nuevaFiesta = async (nombre: string) => {
  const f = await crearFiesta(conexion.db, dueno, { nombre, fechaHora: new Date(Date.now() + 5 * 86_400_000), tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }] });
  const tipo = (await detalleFiesta(conexion.db, f.id, dueno)).tipos[0];
  return { id: f.id, venta: tipo?.tokenVenta ?? "", tipoId: tipo?.id ?? "" };
};
const existe = async (id: string) => (await conexion.db.select().from(fiestas).where(eq(fiestas.id, id))).length > 0;

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  await fijarFechaCorte(conexion.db, dueno, "2026-01-01");
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("eliminar fiesta", () => {
  it("sin plata: se borra todo, también las compras sin pagar y las tandas", async () => {
    const f = await nuevaFiesta("Fiesta de prueba");
    await agregarTanda(conexion.db, dueno, f.tipoId, { precioCentavos: 500000n, hasta: new Date(Date.now() + 86_400_000) });
    await crearCompra(conexion.db, f.venta, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }], email: "a@ejemplo.com" });
    await expect(eliminarFiesta(conexion.db, admin, f.id, {})).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    expect(await antesDeEliminarFiesta(conexion.db, dueno, f.id)).toMatchObject({ pagos: 0, totalCentavos: 0n, entradas: 1 });
    await eliminarFiesta(conexion.db, dueno, f.id, {});
    expect(await existe(f.id)).toBe(false);
    expect(await conexion.db.select().from(entradas).where(eq(entradas.fiestaId, f.id))).toHaveLength(0);
    expect(await conexion.db.select().from(tiposEntrada).where(eq(tiposEntrada.fiestaId, f.id))).toHaveLength(0);
  });

  it("con plata: pide elegir; si se devolvió, sale de la caja", async () => {
    const f = await nuevaFiesta("Fiesta cobrada");
    await crearCompra(conexion.db, f.venta, { entradas: [{ nombre: "Bea Gómez", dni: "41222333" }, { nombre: "Caro Díaz", dni: "42333444" }], email: "b@ejemplo.com" });
    const op = await pagar("41222333", 20000);
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    expect(await antesDeEliminarFiesta(conexion.db, dueno, f.id)).toMatchObject({ pagos: 1, totalCentavos: 2000000n });
    await expect(eliminarFiesta(conexion.db, dueno, f.id, {})).rejects.toMatchObject({ codigo: "FIESTA_CON_PLATA" });
    await eliminarFiesta(conexion.db, dueno, f.id, { plata: { destino: "DEVUELTA" } });
    expect(await existe(f.id)).toBe(false);
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(antes - 2000000n);
    const [t] = await conexion.db.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, op));
    expect(t).toMatchObject({ estado: "RESUELTA", resolucion: "DEVUELTA", pagoId: null });
  });

  it("con plata que queda: entra como otro ingreso con el nombre elegido, y la caja no cambia", async () => {
    const f = await nuevaFiesta("Fiesta ficticia");
    await crearCompra(conexion.db, f.venta, { entradas: [{ nombre: "Dani Sol", dni: "43444555" }], email: "d@ejemplo.com" });
    const op = await pagar("43444555", 10000);
    const cuenta = await saldoDeCuenta(conexion.db, "CUENTA");
    const fiestasAntes = await saldoDeCuenta(conexion.db, "INGRESO:FIESTAS");
    const otrosAntes = await saldoDeCuenta(conexion.db, "INGRESO:OTROS");
    await expect(eliminarFiesta(conexion.db, dueno, f.id, { plata: { destino: "QUEDA", concepto: "" } })).rejects.toThrow();
    await eliminarFiesta(conexion.db, dueno, f.id, { plata: { destino: "QUEDA", concepto: "Prueba de la app" } });
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(cuenta);
    expect(await saldoDeCuenta(conexion.db, "INGRESO:FIESTAS")).toBe(fiestasAntes + 1000000n);
    expect(await saldoDeCuenta(conexion.db, "INGRESO:OTROS")).toBe(otrosAntes - 1000000n);
    const [t] = await conexion.db.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, op));
    const [nuevo] = await conexion.db.select().from(pagos).where(eq(pagos.id, t?.pagoId ?? ""));
    expect(t).toMatchObject({ resolucion: "OTRO_INGRESO" });
    expect(nuevo).toMatchObject({ origen: "OTRO", estado: "CONFIRMADO", nota: "Prueba de la app", montoCentavos: 1000000n });
  });

  it("fuera de esta operación, la base sigue sin dejar borrar fiestas ni entradas", async () => {
    const f = await nuevaFiesta("Otra");
    await expect(conexion.db.delete(fiestas).where(eq(fiestas.id, f.id))).rejects.toThrow();
    await expect(conexion.db.execute(sql`delete from tipos_entrada where fiesta_id = ${f.id}`)).rejects.toThrow();
  });
});
