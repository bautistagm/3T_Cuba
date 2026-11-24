import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { tandas } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { agregarTanda, crearCompra, crearFiesta, detalleFiesta, fiestaParaComprar, quitarTanda } from "./fiestas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let tipoId = "";
let venta = "";
let fiestaId = "";
const dia = 86_400_000;
const enDias = (n: number) => new Date(Date.now() + n * dia);

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta", fechaHora: enDias(10), tipos: [{ nombre: "Hombre", precioCentavos: 2000000n }] });
  fiestaId = f.id;
  const tipo = (await detalleFiesta(conexion.db, f.id, dueno)).tipos[0];
  tipoId = tipo?.id ?? "";
  venta = tipo?.tokenVenta ?? "";
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("tandas", () => {
  it("sin tandas, vale el precio del tipo", async () => {
    const v = await fiestaParaComprar(conexion.db, venta);
    expect(v.tipo).toMatchObject({ precioCentavos: 2000000n, tanda: null });
  });

  it("solo el dueño las maneja, y tienen que terminar en el futuro y antes de la fiesta", async () => {
    await expect(agregarTanda(conexion.db, admin, tipoId, { precioCentavos: 1000000n, hasta: enDias(2) })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await expect(agregarTanda(conexion.db, dueno, tipoId, { precioCentavos: 1000000n, hasta: enDias(-1) })).rejects.toMatchObject({ codigo: "TANDA_PASADA" });
    await expect(agregarTanda(conexion.db, dueno, tipoId, { precioCentavos: 1000000n, hasta: enDias(11) })).rejects.toMatchObject({ codigo: "TANDA_DESPUES_DE_LA_FIESTA" });
  });

  it("manda la primera tanda que no terminó; después, la siguiente; al final, el precio del tipo", async () => {
    const primera = enDias(2);
    const segunda = enDias(5);
    await agregarTanda(conexion.db, dueno, tipoId, { precioCentavos: 1500000n, hasta: segunda });
    await agregarTanda(conexion.db, dueno, tipoId, { precioCentavos: 1000000n, hasta: primera });
    const v = await fiestaParaComprar(conexion.db, venta);
    expect(v.tipo).toMatchObject({ precioCentavos: 1000000n, tanda: { hasta: primera.toISOString(), despuesCentavos: 1500000n } });

    // El precio queda fijo en la compra.
    const c = await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }, { nombre: "Bea Gómez", dni: "41222333" }], email: "a@ejemplo.com" });
    expect(c.totalCentavos).toBe(2000000n);

    const detalle = await detalleFiesta(conexion.db, fiestaId, dueno);
    expect(detalle.tipos[0]).toMatchObject({ precioVigenteCentavos: 1000000n, precioCentavos: 2000000n });
    expect(detalle.tipos[0]?.tandas.map((t) => t.precioCentavos)).toEqual([1000000n, 1500000n]);
  });

  it("se puede quitar una tanda que no terminó; no se edita; una terminada queda", async () => {
    const [t] = await conexion.db.select().from(tandas).where(eq(tandas.precioCentavos, 1500000n));
    await expect(conexion.db.update(tandas).set({ precioCentavos: 1n }).where(eq(tandas.id, t?.id ?? ""))).rejects.toThrow();
    await expect(quitarTanda(conexion.db, admin, t?.id ?? "")).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await quitarTanda(conexion.db, dueno, t?.id ?? "");
    const v = await fiestaParaComprar(conexion.db, venta);
    expect(v.tipo.tanda?.despuesCentavos).toBe(2000000n);
    // Para la app, una tanda que ya terminó no se quita.
    const [otra] = await conexion.db.select().from(tandas);
    await expect(quitarTanda(conexion.db, dueno, otra?.id ?? "", enDias(3))).rejects.toMatchObject({ codigo: "TANDA_TERMINADA" });
  });
});
