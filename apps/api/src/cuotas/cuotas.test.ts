import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { saldoDeCuenta } from "../caja/libro.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { cargos, pagos } from "../db/esquema.js";
import { crearJugador, darDeBaja, datosJugadorSchema, eliminarJugador } from "../jugadores/jugadores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { anularPago } from "../sabados/sabados.js";
import {
  abrirMes,
  agregarCuota,
  anularCuota,
  cambiarMontoDelMes,
  cobrarCuotasEnEfectivo,
  cuotasDeJugador,
  cuotasQueCancela,
  deudores,
  listarMeses,
} from "./cuotas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
const jugador = async (nombre: string, dni: string) =>
  crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre, apellido: "Prueba", dni, telefono: "1155551234" }));

let ana: { id: string };
let beto: { id: string };
let febrero: { id: string };
let marzo: { id: string };

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan Admin", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  ana = await jugador("Ana", "45000001");
  beto = await jugador("Beto", "45000002");
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("meses y cuotas", () => {
  it("solo el dueño abre un mes; a cada jugador activo se le carga la cuota", async () => {
    await expect(abrirMes(conexion.db, admin, { anio: 2027, mes: 2, montoCentavos: 3000000n })).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    const r = await abrirMes(conexion.db, dueno, { anio: 2027, mes: 2, montoCentavos: 3000000n });
    febrero = r.periodo;
    expect(r.cuotasCargadas).toBe(2);
    await expect(abrirMes(conexion.db, dueno, { anio: 2027, mes: 2, montoCentavos: 1n })).rejects.toMatchObject({ codigo: "MES_YA_ABIERTO" });
    const [mes] = await listarMeses(conexion.db);
    expect(mes).toMatchObject({ nombre: "Febrero 2027", pagaron: 0, deben: 2, faltaCentavos: 6000000n });
  });

  it("el monto se corrige mientras nadie haya pagado", async () => {
    await cambiarMontoDelMes(conexion.db, dueno, febrero.id, 3500000n);
    expect((await cuotasDeJugador(conexion.db, ana.id)).cuotas[0]?.montoCentavos).toBe(3500000n);
  });

  it("cobro en efectivo: el pago, la caja y la cuota quedan juntos; el efectivo a cargo de quien cobró", async () => {
    const cuota = (await cuotasDeJugador(conexion.db, ana.id)).cuotas[0];
    const pago = await cobrarCuotasEnEfectivo(conexion.db, admin, ana.id, [cuota?.id ?? ""]);
    expect(pago).toMatchObject({ origen: "CUOTA", medio: "EFECTIVO", montoCentavos: 3500000n, jugadorId: ana.id, recibidoPorAdminId: admin.adminId });
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(3500000n);
    expect((await cuotasDeJugador(conexion.db, ana.id)).cuotas[0]?.estado).toBe("PAGADO");
    await expect(cobrarCuotasEnEfectivo(conexion.db, admin, ana.id, [cuota?.id ?? ""])).rejects.toMatchObject({ codigo: "NO_PENDIENTE" });
    await expect(cambiarMontoDelMes(conexion.db, dueno, febrero.id, 1000n)).rejects.toMatchObject({ codigo: "YA_HAY_PAGOS" });
  });

  it("quién debe: solo los activos con cuotas pendientes", async () => {
    marzo = (await abrirMes(conexion.db, dueno, { anio: 2027, mes: 3, montoCentavos: 4000000n })).periodo;
    const d = await deudores(conexion.db);
    expect(d.deudores.map((x) => `${x.nombre}:${x.cuotas.map((c) => c.mes).join("+")}`)).toEqual(["Ana:Marzo 2027", "Beto:Febrero 2027+Marzo 2027"]);
    expect(d.totalCentavos).toBe(4000000n + 3500000n + 4000000n);
    expect((await deudores(conexion.db, febrero.id)).deudores.map((x) => x.nombre)).toEqual(["Beto"]);
  });

  it("anular el pago devuelve la cuota a pendiente y la caja vuelve atrás", async () => {
    const [pago] = await conexion.db.select().from(pagos).where(eq(pagos.jugadorId, ana.id));
    await anularPago(conexion.db, dueno, pago?.id ?? "", "Se cargó a la persona equivocada");
    expect((await cuotasDeJugador(conexion.db, ana.id)).cuotas.map((c) => c.estado)).toEqual(["PENDIENTE", "PENDIENTE"]);
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(0n);
  });

  it("dos meses juntos en un solo pago", async () => {
    const ids = (await cuotasDeJugador(conexion.db, beto.id)).cuotas.map((c) => c.id);
    const pago = await cobrarCuotasEnEfectivo(conexion.db, dueno, beto.id, ids);
    expect(pago.montoCentavos).toBe(3500000n + 4000000n);
  });

  it("la base no deja un pago de cuotas que no cuadre, ni borrar cuotas", async () => {
    const [pagado] = await conexion.db.select().from(cargos).where(eq(cargos.estado, "PAGADO")).limit(1);
    await expect(conexion.db.update(cargos).set({ estado: "PENDIENTE", pagoId: null }).where(eq(cargos.id, pagado?.id ?? ""))).rejects.toThrow();
    await expect(conexion.db.delete(cargos).where(eq(cargos.id, pagado?.id ?? ""))).rejects.toThrow();
    await expect(conexion.db.execute(sql`UPDATE cargos SET monto_centavos = 1 WHERE estado = 'PAGADO'`)).rejects.toThrow();
  });

  it("alta a mitad de mes: el dueño decide si le agrega la cuota; también puede anularla con motivo", async () => {
    const caro = await jugador("Caro", "45000003");
    const antes = await cuotasDeJugador(conexion.db, caro.id);
    expect(antes.cuotas).toHaveLength(0);
    expect(antes.mesesSinCuota.map((m) => m.mes)).toEqual(["Marzo 2027", "Febrero 2027"]);
    await expect(agregarCuota(conexion.db, admin, caro.id, marzo.id)).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    const c = await agregarCuota(conexion.db, dueno, caro.id, marzo.id);
    await expect(agregarCuota(conexion.db, dueno, caro.id, marzo.id)).rejects.toMatchObject({ codigo: "YA_TIENE_CUOTA" });
    await expect(anularCuota(conexion.db, dueno, c.id, "no")).rejects.toMatchObject({ codigo: "FALTA_MOTIVO" });
    expect((await anularCuota(conexion.db, dueno, c.id, "Se sumó el 28 de marzo"))?.estado).toBe("ANULADO");
  });

  it("de baja no aparece en quién debe; eliminado: sin datos y sus cuotas pendientes anuladas", async () => {
    await darDeBaja(conexion.db, dueno, ana.id);
    expect((await deudores(conexion.db)).deudores.some((d) => d.jugadorId === ana.id)).toBe(false);
    expect(await eliminarJugador(conexion.db, dueno, ana.id, "Ana Prueba")).toEqual({ borrado: false, anonimizado: true });
    const cuotasDeAna = await conexion.db.select().from(cargos).where(eq(cargos.jugadorId, ana.id));
    expect(cuotasDeAna.every((c) => c.estado === "ANULADO")).toBe(true);
  });
});

describe("qué cuotas cancela un monto (para la verificación automática)", () => {
  const c = (monto: bigint, id: string) => ({ id, montoCentavos: monto });
  const pendientes = [c(3000000n, "feb"), c(4000000n, "mar"), c(3000000n, "abr")];
  it("la más vieja, o la suma exacta de las más viejas", () => {
    expect(cuotasQueCancela(pendientes, 3000000n)?.map((x) => x.id)).toEqual(["feb"]);
    expect(cuotasQueCancela(pendientes, 7000000n)?.map((x) => x.id)).toEqual(["feb", "mar"]);
    expect(cuotasQueCancela(pendientes, 10000000n)?.map((x) => x.id)).toEqual(["feb", "mar", "abr"]);
  });
  it("cualquier otro monto: nada (va a Revisar)", () => {
    expect(cuotasQueCancela(pendientes, 4000000n)).toBeNull(); // marzo solo, salteando febrero
    expect(cuotasQueCancela(pendientes, 2999999n)).toBeNull();
    expect(cuotasQueCancela(pendientes, 11000000n)).toBeNull();
    expect(cuotasQueCancela([], 3000000n)).toBeNull();
  });
});
