import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import { adelantar, codigoCuentaCocina, crearCocina, resumenCocina } from "../cocina/cocina.js";
import { abrirMes, cobrarCuotasEnEfectivo, cuotasDeJugador } from "../cuotas/cuotas.js";
import type { ConexionBase } from "../db/cliente.js";
import { cargos, cocinas, comprasEntradas, entradas, movimientosCocina, pagos, tandas } from "../db/esquema.js";
import { agregarTanda, crearCompra, crearFiesta, detalleFiesta } from "../fiestas/fiestas.js";
import { crearJugador, datosJugadorSchema } from "../jugadores/jugadores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { cobrarInvitado, obtenerOCrearSabado } from "../sabados/sabados.js";
import { fijarFechaCorte, leerCuenta } from "../verificacion/transferencias.js";
import {
  editarCobro,
  editarCocina,
  editarCuota,
  editarEntrada,
  editarMovimientoCocina,
  editarTanda,
  eliminarCobro,
  eliminarCompra,
  eliminarCuota,
  eliminarMovimientoCocina,
} from "./sueltos.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let sabadoId = "";
const efectivo = () => saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId));

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  sabadoId = (await obtenerOCrearSabado(conexion.db, "2027-01-02")).id;
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("cobros a invitados", () => {
  it("editar: corrige monto y nombre; la caja queda con el monto nuevo y el viejo desaparece", async () => {
    const c = await cobrarInvitado(conexion.db, admin, { sabadoId, medio: "EFECTIVO", montoCentavos: 1_000_000n, nombre: "Pedro" });
    const antes = await efectivo();
    await expect(editarCobro(conexion.db, admin, c.id, { montoCentavos: 1n, medio: "EFECTIVO" })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    const nuevo = await editarCobro(conexion.db, dueno, c.id, { montoCentavos: 1_500_000n, medio: "EFECTIVO", nombre: "Pedro Gómez" });
    expect(await efectivo()).toBe(antes + 500_000n);
    expect(nuevo).toMatchObject({ nombrePagador: "Pedro Gómez", recibidoPorAdminId: admin.adminId, sabadoId });
    expect(await conexion.db.select().from(pagos).where(eq(pagos.id, c.id))).toHaveLength(0);
  });

  it("eliminar: devuelto sale de la caja; queda pasa a otro ingreso", async () => {
    const a = await cobrarInvitado(conexion.db, admin, { sabadoId, medio: "EFECTIVO", montoCentavos: 1_000_000n });
    const b = await cobrarInvitado(conexion.db, admin, { sabadoId, medio: "EFECTIVO", montoCentavos: 1_000_000n });
    const antes = await efectivo();
    await expect(eliminarCobro(conexion.db, dueno, a.id, undefined)).rejects.toMatchObject({ codigo: "CON_PLATA" });
    await eliminarCobro(conexion.db, dueno, a.id, { destino: "DEVUELTA" });
    expect(await efectivo()).toBe(antes - 1_000_000n);
    await eliminarCobro(conexion.db, dueno, b.id, { destino: "QUEDA", concepto: "Prueba de la app" });
    expect(await efectivo()).toBe(antes - 1_000_000n);
    const [otro] = await conexion.db.select().from(pagos).where(eq(pagos.nota, "Prueba de la app"));
    expect(otro).toMatchObject({ origen: "OTRO", montoCentavos: 1_000_000n });
  });
});

describe("cocina", () => {
  it("editar datos, corregir y eliminar un adelanto", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2027-01-09");
    const { cocina } = await crearCocina(conexion.db, admin, { sabadoId: s.id, camada: "2015", responsableNombre: "Agustín" });
    await editarCocina(conexion.db, dueno, cocina.id, { camada: "2016", responsableNombre: "Agustín Pérez", responsableTelefono: "11 5555-5555" });
    expect((await conexion.db.select().from(cocinas).where(eq(cocinas.id, cocina.id)))[0]).toMatchObject({ camada: "2016", responsableNombre: "Agustín Pérez" });
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    const [mov] = await conexion.db.select().from(movimientosCocina).where(eq(movimientosCocina.cocinaId, cocina.id));
    await editarMovimientoCocina(conexion.db, dueno, mov?.id ?? "", 15_000_000n);
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(15_000_000n);
    const [nuevo] = await conexion.db.select().from(movimientosCocina).where(eq(movimientosCocina.cocinaId, cocina.id));
    expect(nuevo?.montoCentavos).toBe(15_000_000n);
    await eliminarMovimientoCocina(conexion.db, dueno, nuevo?.id ?? "");
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(0n);
    expect((await resumenCocina(conexion.db, cocina.id)).movimientos).toHaveLength(0);
  });
});

describe("cuotas", () => {
  it("corregir una pendiente; eliminar una pagada que estaba en un pago de dos meses", async () => {
    const j = await crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre: "Ana", apellido: "Prueba", dni: "40111222", telefono: "1155551234" }));
    await abrirMes(conexion.db, dueno, { anio: 2027, mes: 1, montoCentavos: 2_000_000n });
    await abrirMes(conexion.db, dueno, { anio: 2027, mes: 2, montoCentavos: 2_000_000n });
    await abrirMes(conexion.db, dueno, { anio: 2027, mes: 3, montoCentavos: 2_000_000n });
    const lista = (await cuotasDeJugador(conexion.db, j.id)).cuotas;
    await editarCuota(conexion.db, dueno, lista[0]?.id ?? "", 1_500_000n);
    const pendientes = (await cuotasDeJugador(conexion.db, j.id)).cuotas.filter((c) => c.estado === "PENDIENTE").slice(0, 2);
    await cobrarCuotasEnEfectivo(conexion.db, admin, j.id, pendientes.map((c) => c.id));
    await expect(editarCuota(conexion.db, dueno, pendientes[0]?.id ?? "", 1n)).rejects.toMatchObject({ codigo: "NO_PENDIENTE" });
    const antes = await efectivo();
    await eliminarCuota(conexion.db, dueno, pendientes[1]?.id ?? "", { destino: "DEVUELTA" });
    expect(await efectivo()).toBe(antes - BigInt(pendientes[1]?.montoCentavos ?? "0"));
    const [quedo] = await conexion.db.select().from(cargos).where(eq(cargos.id, pendientes[0]?.id ?? ""));
    expect(quedo?.estado).toBe("PAGADO");
    expect(await conexion.db.select().from(cargos).where(eq(cargos.id, pendientes[1]?.id ?? ""))).toHaveLength(0);
  });
});

describe("compras, entradas y tandas", () => {
  it("eliminar compras (sin pagar y pagada), editar una entrada y una tanda", async () => {
    await fijarFechaCorte(conexion.db, dueno, "2026-01-01");
    const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta", fechaHora: new Date(Date.now() + 10 * 86_400_000), tipos: [{ nombre: "Mujer", precioCentavos: 1_000_000n }] });
    const tipo = (await detalleFiesta(conexion.db, f.id, dueno)).tipos[0];
    const venta = tipo?.tokenVenta ?? "";
    await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }], email: "a@ejemplo.com" });
    await crearCompra(conexion.db, venta, { entradas: [{ nombre: "Bea Gómez", dni: "41222333" }], email: "b@ejemplo.com" });
    await leerCuenta(conexion.db, async () => [{ mpPagoId: "9001", e2eId: null, montoCentavos: 1_000_000n, fecha: new Date(Date.now() - 60_000), cuitPagador: "27412223334" }], {});
    const compras = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.fiestaId, f.id));
    const pendiente = compras.find((c) => c.estado === "PENDIENTE_PAGO");
    const pagada = compras.find((c) => c.estado === "PAGADA");
    await eliminarCompra(conexion.db, dueno, pendiente?.id ?? "", undefined);
    const cuenta = await saldoDeCuenta(conexion.db, "CUENTA");
    const [entradaBea] = await conexion.db.select().from(entradas).where(eq(entradas.compraId, pagada?.id ?? ""));
    await editarEntrada(conexion.db, dueno, entradaBea?.id ?? "", { nombre: "Beatriz Gómez", dni: "41.222.334" });
    expect((await conexion.db.select().from(entradas).where(eq(entradas.id, entradaBea?.id ?? "")))[0]).toMatchObject({ nombre: "Beatriz Gómez", dni: "41222334" });
    await expect(eliminarCompra(conexion.db, dueno, pagada?.id ?? "", undefined)).rejects.toMatchObject({ codigo: "CON_PLATA" });
    await eliminarCompra(conexion.db, dueno, pagada?.id ?? "", { destino: "DEVUELTA" });
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(cuenta - 1_000_000n);
    expect(await conexion.db.select().from(entradas).where(eq(entradas.fiestaId, f.id))).toHaveLength(0);

    const t = await agregarTanda(conexion.db, dueno, tipo?.id ?? "", { precioCentavos: 800_000n, hasta: new Date(Date.now() + 2 * 86_400_000) });
    const nueva = await editarTanda(conexion.db, dueno, t?.id ?? "", { precioCentavos: 700_000n, hasta: new Date(Date.now() + 3 * 86_400_000) });
    expect(nueva?.precioCentavos).toBe(700_000n);
    expect(await conexion.db.select().from(tandas).where(eq(tandas.tipoId, tipo?.id ?? ""))).toHaveLength(1);
  });
});
