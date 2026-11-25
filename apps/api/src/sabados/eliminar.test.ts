import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import { adelantar, cerrarCocina, crearCocina, gastoDeCocina } from "../cocina/cocina.js";
import type { ConexionBase } from "../db/cliente.js";
import { cocinas, gastos, pagos, sabados } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { antesDeEliminarSabado, eliminarSabado } from "./eliminar.js";
import { anularPago, cobrarInvitado, obtenerOCrearSabado } from "./sabados.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let semana = 0;
const nuevoSabado = () => obtenerOCrearSabado(conexion.db, new Date(Date.UTC(2027, 0, 2 + 7 * semana++)).toISOString().slice(0, 10));
async function sabadoCompleto(cerrar = false) {
  const s = await nuevoSabado();
  await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO", montoCentavos: 1_000_000n });
  await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "TRANSFERENCIA", montoCentavos: 1_000_000n });
  const { cocina } = await crearCocina(conexion.db, admin, { sabadoId: s.id, camada: "2015", responsableNombre: "Agustín", responsableTelefono: "11 5555-5555" });
  await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
  await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, proveedor: "Carnicería", origenCarga: "MANUAL", items: [{ descripcion: "Vacío", categoria: "CARNE", subtotalCentavos: 15_000_000n }] });
  if (cerrar) await cerrarCocina(conexion.db, dueno, { cocinaId: cocina.id, forma: "DEVOLUCION_TRANSFERENCIA" });
  return { sabado: s, cocina };
}
const saldos = async () => ({
  cuenta: await saldoDeCuenta(conexion.db, "CUENTA"),
  efectivo: await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId)),
  otros: await saldoDeCuenta(conexion.db, "INGRESO:OTROS"),
  egresoOtros: await saldoDeCuenta(conexion.db, "EGRESO:OTROS"),
});
const existe = async (id: string) => (await conexion.db.select().from(sabados).where(eq(sabados.id, id))).length > 0;

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

describe("eliminar sábado", () => {
  it("un sábado vacío se borra sin preguntar; solo el dueño", async () => {
    const s = await nuevoSabado();
    await expect(eliminarSabado(conexion.db, admin, s.id, {})).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await eliminarSabado(conexion.db, dueno, s.id, {});
    expect(await existe(s.id)).toBe(false);
  });

  it("muestra cuánto movió y exige elegir por cobros y por cocina", async () => {
    const { sabado } = await sabadoCompleto();
    expect(await antesDeEliminarSabado(conexion.db, dueno, sabado.id)).toMatchObject({
      cobros: 2,
      cobrosCentavos: 2_000_000n,
      tieneCocina: true,
      cocinaGastadoCentavos: 20_000_000n,
      enManosDeLaCamadaCentavos: 5_000_000n,
    });
    await expect(eliminarSabado(conexion.db, dueno, sabado.id, { cocina: { destino: "VOLVIO" } })).rejects.toMatchObject({ codigo: "SABADO_CON_COBROS" });
    await expect(eliminarSabado(conexion.db, dueno, sabado.id, { cobros: { destino: "DEVUELTOS" } })).rejects.toMatchObject({ codigo: "SABADO_CON_COCINA" });
  });

  it("devueltos y volvió todo: la caja queda como si el sábado no hubiera existido", async () => {
    const antes = await saldos();
    const { sabado, cocina } = await sabadoCompleto();
    await eliminarSabado(conexion.db, dueno, sabado.id, { cobros: { destino: "DEVUELTOS" }, cocina: { destino: "VOLVIO" } });
    expect(await saldos()).toEqual(antes);
    expect(await existe(sabado.id)).toBe(false);
    expect(await conexion.db.select().from(cocinas).where(eq(cocinas.id, cocina.id))).toHaveLength(0);
    expect(await conexion.db.select().from(pagos).where(eq(pagos.sabadoId, sabado.id))).toHaveLength(0);
    expect(await conexion.db.select().from(gastos).where(eq(gastos.cocinaId, cocina.id))).toHaveLength(0);
  });

  it("quedan y se gastó igual (cocina cerrada): cobros como otro ingreso y un solo gasto con nombre", async () => {
    const antes = await saldos();
    const { sabado } = await sabadoCompleto(true);
    const despuesDelSabado = await saldos();
    const r = await eliminarSabado(conexion.db, dueno, sabado.id, {
      cobros: { destino: "QUEDAN", concepto: "Invitados de prueba" },
      cocina: { destino: "SE_GASTO", concepto: "Cocina de prueba" },
    });
    const ahora = await saldos();
    // La plata real no se mueve: la cuenta y el efectivo quedan como después del sábado.
    expect(ahora.cuenta).toBe(despuesDelSabado.cuenta);
    expect(ahora.efectivo).toBe(despuesDelSabado.efectivo);
    expect(ahora.otros).toBe(antes.otros - 2_000_000n);
    expect(ahora.egresoOtros).toBe(antes.egresoOtros + 15_000_000n); // se devolvieron 50.000 al cerrar
    const [g] = await conexion.db.select().from(gastos).where(eq(gastos.id, r.gastoNuevoId ?? ""));
    expect(g).toMatchObject({ descripcion: "Cocina de prueba", totalCentavos: 15_000_000n, cuentaOrigenCodigo: "CUENTA", cocinaId: null });
    const otros = await conexion.db.select().from(pagos).where(eq(pagos.nota, "Invitados de prueba"));
    expect(otros.map((p) => p.medio).sort()).toEqual(["EFECTIVO", "TRANSFERENCIA"]);
  });

  it("con cobros ya anulados, también se borra", async () => {
    const s = await nuevoSabado();
    const p = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO", montoCentavos: 1_000_000n });
    await anularPago(conexion.db, dueno, p.id, "Cargado de más");
    await eliminarSabado(conexion.db, dueno, s.id, {});
    expect(await existe(s.id)).toBe(false);
  });

  it("fuera de esta operación, la base no deja borrar cobros, cocinas ni movimientos", async () => {
    const { sabado, cocina } = await sabadoCompleto();
    await expect(conexion.db.delete(pagos).where(eq(pagos.sabadoId, sabado.id))).rejects.toThrow();
    await expect(conexion.db.delete(cocinas).where(eq(cocinas.id, cocina.id))).rejects.toThrow();
  });
});
