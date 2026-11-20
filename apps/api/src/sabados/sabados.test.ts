import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { pagos } from "../db/esquema.js";
import { ErrorNegocio } from "../errores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { esSabado, sabadoCorrespondiente } from "./fechas.js";
import {
  anularPago,
  cobrarInvitado,
  cobrosDelSabado,
  fijarPrecioInvitado,
  listarSabados,
  marcarLocal,
  obtenerOCrearSabado,
  precioInvitado,
} from "./sabados.js";

describe("qué sábado corresponde (hora de Argentina)", () => {
  it.each([
    ["2026-11-21T15:00:00-03:00", "2026-11-21"], // sábado a la tarde
    ["2026-11-22T03:30:00-03:00", "2026-11-21"], // domingo de madrugada: sigue el tercer tiempo
    ["2026-11-22T09:00:00-03:00", "2026-11-28"], // domingo a la mañana: ya es el próximo
    ["2026-11-20T23:59:00-03:00", "2026-11-21"], // viernes a la noche
    ["2026-11-21T02:00:00Z", "2026-11-21"], // viernes 23 hs en Argentina, ya sábado en UTC
    ["2026-12-30T12:00:00-03:00", "2027-01-02"], // cambio de año
  ])("%s → %s", (momento, esperado) => {
    expect(sabadoCorrespondiente(new Date(momento))).toBe(esperado);
  });

  it("reconoce sábados", () => {
    expect(esSabado("2026-11-21")).toBe(true);
    expect(esSabado("2026-11-22")).toBe(false);
    expect(esSabado("21/11/2026")).toBe(false);
  });
});

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;

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

describe("sábados", () => {
  it("se crean solos y no se duplican", async () => {
    const a = await obtenerOCrearSabado(conexion.db, "2026-11-21");
    const b = await obtenerOCrearSabado(conexion.db, "2026-11-21");
    expect(a.id).toBe(b.id);
  });

  it("no acepta una fecha que no es sábado", async () => {
    await expect(obtenerOCrearSabado(conexion.db, "2026-11-22")).rejects.toBeInstanceOf(ErrorNegocio);
  });

  it("se puede marcar de local", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2026-11-28");
    const actualizado = await marcarLocal(conexion.db, admin, s.id, true);
    expect(actualizado?.esLocal).toBe(true);
  });
});

describe("precio de los invitados", () => {
  it("solo lo fija el dueño", async () => {
    await expect(fijarPrecioInvitado(conexion.db, admin, 1_500_000n)).rejects.toThrow("Solo el dueño");
    await fijarPrecioInvitado(conexion.db, dueno, 1_500_000n);
    expect(await precioInvitado(conexion.db)).toBe(1_500_000n);
    await fijarPrecioInvitado(conexion.db, dueno, 1_800_000n);
    expect(await precioInvitado(conexion.db)).toBe(1_800_000n);
  });
});

describe("cobrar invitados", () => {
  it("en efectivo: la plata queda a cargo del admin que cobró, con nombre y camada opcionales", async () => {
    await fijarPrecioInvitado(conexion.db, dueno, 1_500_000n);
    const s = await obtenerOCrearSabado(conexion.db, "2026-12-05");
    const antes = await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId));
    const pago = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO", nombre: " Pedro ", camada: "2015" });
    expect(pago.montoCentavos).toBe(1_500_000n);
    expect(pago.nombrePagador).toBe("Pedro");
    expect(pago.camadaPagador).toBe("2015");
    expect(pago.recibidoPorAdminId).toBe(admin.adminId);
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(antes + 1_500_000n);
  });

  it("por transferencia entra a la cuenta del plantel; sin nombre ni camada también vale", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2026-12-05");
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    const pago = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "TRANSFERENCIA", nombre: "  " });
    expect(pago.nombrePagador).toBeNull();
    expect(pago.recibidoPorAdminId).toBeNull();
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(antes + 1_500_000n);
  });

  it("el total del sábado cuenta solo los cobros vigentes", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2026-12-12");
    const p1 = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO" });
    await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO" });
    await anularPago(conexion.db, dueno, p1.id, "Lo cargué dos veces");
    const lista = await listarSabados(conexion.db);
    const fila = lista.find((x) => x.id === s.id);
    expect(fila?.invitados).toBe(1);
    expect(fila?.cobradoCentavos).toBe("1500000");
    expect(await cobrosDelSabado(conexion.db, s.id)).toHaveLength(2);
  });

  it("sin precio fijado y sin monto, no cobra", async () => {
    await conexion.db.execute(sql`delete from parametros`);
    const s = await obtenerOCrearSabado(conexion.db, "2026-12-19");
    await expect(cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO" })).rejects.toThrow("precio");
    await fijarPrecioInvitado(conexion.db, dueno, 1_500_000n);
  });
});

describe("anular cobros", () => {
  it("solo el dueño, con motivo; la plata vuelve a como estaba y el cobro queda (no se borra)", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2027-01-02");
    const antes = await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId));
    const pago = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO" });
    await expect(anularPago(conexion.db, admin, pago.id, "No vino")).rejects.toThrow("Solo el dueño");
    const anulado = await anularPago(conexion.db, dueno, pago.id, "Se cargó por error");
    expect(anulado?.estado).toBe("ANULADO");
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(antes);
    await expect(anularPago(conexion.db, dueno, pago.id, "Otra vez")).rejects.toThrow("ya estaba anulado");
  });

  it("la base no deja cambiar el monto de un cobro ni borrarlo", async () => {
    const s = await obtenerOCrearSabado(conexion.db, "2027-01-02");
    const pago = await cobrarInvitado(conexion.db, admin, { sabadoId: s.id, medio: "EFECTIVO" });
    await expect(conexion.db.update(pagos).set({ montoCentavos: 1n }).where(eq(pagos.id, pago.id))).rejects.toThrow();
    await expect(conexion.db.delete(pagos).where(eq(pagos.id, pago.id))).rejects.toThrow();
    await expect(conexion.db.update(pagos).set({ nombrePagador: "Otro" }).where(eq(pagos.id, pago.id))).rejects.toThrow();
  });
});
