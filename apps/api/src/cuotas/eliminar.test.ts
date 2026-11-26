import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { cargos, pagos, periodosCuota } from "../db/esquema.js";
import { crearJugador, datosJugadorSchema } from "../jugadores/jugadores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { abrirMes, cobrarCuotasEnEfectivo, cuotasDeJugador } from "./cuotas.js";
import { antesDeEliminarMes, editarMes, eliminarMes } from "./eliminar.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let mes = 1;
const nuevoMes = async (monto = 2_000_000n) => (await abrirMes(conexion.db, dueno, { anio: 2027, mes: mes++, montoCentavos: monto })).periodo;
const jugador = (nombre: string, dni: string) => crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre, apellido: "Prueba", dni, telefono: "1155551234" }));
const caja = async () => ({
  efectivo: await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId)),
  cuotas: await saldoDeCuenta(conexion.db, "INGRESO:CUOTAS"),
  otros: await saldoDeCuenta(conexion.db, "INGRESO:OTROS"),
});
let ana: { id: string };

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  ana = await jugador("Ana", "40111222");
  await jugador("Beto", "41222333");
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("eliminar mes de cuotas", () => {
  it("sin pagos: se borra el mes con sus cuotas; solo el dueño", async () => {
    const m = await nuevoMes();
    await expect(eliminarMes(conexion.db, admin, m.id, {})).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    expect(await antesDeEliminarMes(conexion.db, dueno, m.id)).toMatchObject({ cuotas: 2, pagaron: 0 });
    await eliminarMes(conexion.db, dueno, m.id, {});
    expect(await conexion.db.select().from(periodosCuota).where(eq(periodosCuota.id, m.id))).toHaveLength(0);
    expect(await conexion.db.select().from(cargos).where(eq(cargos.periodoId, m.id))).toHaveLength(0);
  });

  it("si un pago cubría dos meses, el otro mes sigue pagado; la parte del mes borrado queda como otro ingreso", async () => {
    const m1 = await nuevoMes();
    const m2 = await nuevoMes();
    const pendientes = (await cuotasDeJugador(conexion.db, ana.id)).cuotas.filter((c) => c.estado === "PENDIENTE");
    await cobrarCuotasEnEfectivo(conexion.db, admin, ana.id, pendientes.map((c) => c.id));
    const antes = await caja();
    await expect(eliminarMes(conexion.db, dueno, m2.id, {})).rejects.toMatchObject({ codigo: "MES_CON_PAGOS" });
    await eliminarMes(conexion.db, dueno, m2.id, { plata: { destino: "QUEDA", concepto: "Prueba de la app" } });
    const despues = await caja();
    expect(despues.efectivo).toBe(antes.efectivo); // la plata sigue en el bolsillo del admin
    expect(despues.cuotas).toBe(antes.cuotas + 2_000_000n);
    expect(despues.otros).toBe(antes.otros - 2_000_000n);
    const [c1] = await conexion.db.select().from(cargos).where(eq(cargos.periodoId, m1.id)).then((r) => r.filter((c) => c.jugadorId === ana.id));
    expect(c1?.estado).toBe("PAGADO");
    const [nuevo] = await conexion.db.select().from(pagos).where(eq(pagos.id, c1?.pagoId ?? ""));
    expect(nuevo).toMatchObject({ estado: "CONFIRMADO", montoCentavos: 2_000_000n, medio: "EFECTIVO", recibidoPorAdminId: admin.adminId });
  });

  it("si se devolvió, la plata sale de la caja", async () => {
    const m = await nuevoMes();
    const [c] = (await cuotasDeJugador(conexion.db, ana.id)).cuotas.filter((x) => x.estado === "PENDIENTE");
    await cobrarCuotasEnEfectivo(conexion.db, admin, ana.id, [c?.id ?? ""]);
    const antes = await caja();
    await eliminarMes(conexion.db, dueno, m.id, { plata: { destino: "DEVUELTA" } });
    expect((await caja()).efectivo).toBe(antes.efectivo - 2_000_000n);
  });

  it("editar: cambia el monto de las pendientes aunque haya pagos; las pagadas quedan", async () => {
    const m = await nuevoMes();
    const [c] = (await cuotasDeJugador(conexion.db, ana.id)).cuotas.filter((x) => x.estado === "PENDIENTE");
    await cobrarCuotasEnEfectivo(conexion.db, admin, ana.id, [c?.id ?? ""]);
    await expect(editarMes(conexion.db, admin, m.id, { montoCentavos: 1n })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    const r = await editarMes(conexion.db, dueno, m.id, { montoCentavos: 2_500_000n, nota: "Aumento" });
    expect(r.cuotasCambiadas).toBe(1);
    const filas = await conexion.db.select().from(cargos).where(eq(cargos.periodoId, m.id));
    expect(filas.map((f) => [f.estado, f.montoCentavos]).sort()).toEqual([["PAGADO", 2_000_000n], ["PENDIENTE", 2_500_000n]]);
  });

  it("fuera de esta operación, la base no deja borrar meses ni cuotas", async () => {
    const m = await nuevoMes();
    await expect(conexion.db.delete(cargos).where(eq(cargos.periodoId, m.id))).rejects.toThrow();
    await expect(conexion.db.delete(periodosCuota).where(eq(periodosCuota.id, m.id))).rejects.toThrow();
  });
});
