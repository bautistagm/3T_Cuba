import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { agregarTanda, crearCompra, crearFiesta, detalleFiesta, editarFiesta, fiestaParaComprar } from "./fiestas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
const dia = 86_400_000;

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("editar fiesta", () => {
  it("el dueño cambia datos, renombra, cambia precios y agrega tipos; las compras cargadas mantienen su precio", async () => {
    const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta", fechaHora: new Date(Date.now() + 10 * dia), tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }] });
    const tipo = (await detalleFiesta(conexion.db, f.id, dueno)).tipos[0];
    const compra = await crearCompra(conexion.db, tipo?.tokenVenta ?? "", { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }], email: "a@ejemplo.com" });
    await expect(editarFiesta(conexion.db, admin, f.id, { nombre: "X", fechaHora: new Date(), tipos: [] })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await editarFiesta(conexion.db, dueno, f.id, {
      nombre: "Fiesta de fin de año",
      fechaHora: new Date(Date.now() + 12 * dia),
      lugar: "Club",
      tipos: [{ id: tipo?.id, nombre: "Mujeres", precioCentavos: 1200000n }, { nombre: "Hombres", precioCentavos: 2000000n }],
    });
    const d = await detalleFiesta(conexion.db, f.id, dueno);
    expect(d.fiesta).toMatchObject({ nombre: "Fiesta de fin de año", lugar: "Club" });
    expect(d.tipos.map((t) => [t.nombre, t.precioCentavos])).toEqual([["Mujeres", 1200000n], ["Hombres", 2000000n]]);
    expect((await fiestaParaComprar(conexion.db, tipo?.tokenVenta ?? "")).tipo.precioCentavos).toBe(1200000n);
    expect(compra.totalCentavos).toBe(1000000n);
    expect(d.entradas[0]?.estado).toBe("PENDIENTE_PAGO");
  });

  it("no deja sacar tipos ni poner la fecha antes de una tanda", async () => {
    const f = await crearFiesta(conexion.db, dueno, { nombre: "Otra", fechaHora: new Date(Date.now() + 10 * dia), tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }, { nombre: "Hombre", precioCentavos: 1500000n }] });
    const [a, b] = (await detalleFiesta(conexion.db, f.id, dueno)).tipos;
    await expect(editarFiesta(conexion.db, dueno, f.id, { nombre: "Otra", fechaHora: new Date(Date.now() + 10 * dia), tipos: [{ id: a?.id, nombre: "Mujer", precioCentavos: 1000000n }] })).rejects.toMatchObject({ codigo: "TIPO_FALTANTE" });
    await agregarTanda(conexion.db, dueno, b?.id ?? "", { precioCentavos: 1000000n, hasta: new Date(Date.now() + 5 * dia) });
    await expect(
      editarFiesta(conexion.db, dueno, f.id, { nombre: "Otra", fechaHora: new Date(Date.now() + 3 * dia), tipos: [{ id: a?.id, nombre: "Mujer", precioCentavos: 1000000n }, { id: b?.id, nombre: "Hombre", precioCentavos: 1500000n }] }),
    ).rejects.toMatchObject({ codigo: "FECHA_ANTES_DE_TANDA" });
  });
});
