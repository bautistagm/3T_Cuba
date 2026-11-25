import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import { adelantar, cerrarCocina, codigoCuentaCocina, crearCocina, gastoDeCocina, resumenCocina } from "../cocina/cocina.js";
import type { ConexionBase } from "../db/cliente.js";
import { gastoItems, gastos } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { obtenerOCrearSabado } from "../sabados/sabados.js";
import { anularGasto, eliminarGasto, type ItemGasto } from "./gastos.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let semana = 0;
const items: ItemGasto[] = [
  { descripcion: "Vacío", cantidad: "15 kg", categoria: "CARNE", subtotalCentavos: 12_000_000n },
  { descripcion: "Pan", categoria: "INSUMOS", subtotalCentavos: 3_000_000n },
];
async function cocinaConGasto() {
  const fecha = new Date(Date.UTC(2027, 0, 2 + 7 * semana++)).toISOString().slice(0, 10);
  const sabado = await obtenerOCrearSabado(conexion.db, fecha);
  const { cocina } = await crearCocina(conexion.db, admin, { sabadoId: sabado.id, camada: "2015", responsableNombre: "Agustín", responsableTelefono: "11 5555-5555" });
  await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
  const gasto = await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, proveedor: "Carnicería", origenCarga: "MANUAL", items });
  return { cocina, gasto };
}
const existe = async (id: string) => (await conexion.db.select().from(gastos).where(eq(gastos.id, id))).length > 0;

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

describe("eliminar gasto", () => {
  it("solo el dueño; tiene que elegir qué pasó con la plata", async () => {
    const { gasto } = await cocinaConGasto();
    await expect(eliminarGasto(conexion.db, admin, gasto.id, { destino: "VUELVE" })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await expect(eliminarGasto(conexion.db, dueno, gasto.id, null)).rejects.toThrow();
    expect(await existe(gasto.id)).toBe(true);
  });

  it("«no se gastó»: la plata vuelve a la cocina y el gasto desaparece con su detalle", async () => {
    const { cocina, gasto } = await cocinaConGasto();
    const antes = await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id));
    await eliminarGasto(conexion.db, dueno, gasto.id, { destino: "VUELVE" });
    expect(await existe(gasto.id)).toBe(false);
    expect(await conexion.db.select().from(gastoItems).where(eq(gastoItems.gastoId, gasto.id))).toHaveLength(0);
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(antes + 15_000_000n);
  });

  it("«se gastó igual»: queda un gasto Otros con el nombre elegido y la caja no cambia", async () => {
    const { cocina, gasto } = await cocinaConGasto();
    const antes = await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id));
    const r = await eliminarGasto(conexion.db, dueno, gasto.id, { destino: "SE_GASTO", concepto: "Prueba de la app" });
    expect(await existe(gasto.id)).toBe(false);
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(antes);
    const [nuevo] = await conexion.db.select().from(gastos).where(eq(gastos.id, r.reemplazoId ?? ""));
    expect(nuevo).toMatchObject({ descripcion: "Prueba de la app", totalCentavos: 15_000_000n, cocinaId: cocina.id });
    expect((await resumenCocina(conexion.db, cocina.id)).gastos.length).toBe(1);
  });

  it("un gasto anulado se borra sin preguntar; uno de una cocina cerrada no", async () => {
    const { gasto } = await cocinaConGasto();
    await anularGasto(conexion.db, dueno, gasto.id, "Repetido");
    await eliminarGasto(conexion.db, dueno, gasto.id, null);
    expect(await existe(gasto.id)).toBe(false);

    const otro = await cocinaConGasto();
    await cerrarCocina(conexion.db, dueno, { cocinaId: otro.cocina.id, forma: "DEVOLUCION_TRANSFERENCIA" });
    await expect(eliminarGasto(conexion.db, dueno, otro.gasto.id, { destino: "VUELVE" })).rejects.toMatchObject({ codigo: "COCINA_CERRADA" });
  });

  it("fuera de esta operación, la base no deja borrar gastos", async () => {
    const { gasto } = await cocinaConGasto();
    await expect(conexion.db.delete(gastos).where(eq(gastos.id, gasto.id))).rejects.toThrow();
    await expect(conexion.db.delete(gastoItems).where(eq(gastoItems.gastoId, gasto.id))).rejects.toThrow();
  });
});
