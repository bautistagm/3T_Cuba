import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { adelantar, crearCocina } from "../cocina/cocina.js";
import type { ConexionBase } from "../db/cliente.js";
import { controlesCaja, traspasosEfectivo } from "../db/esquema.js";
import type { LecturaTicket, LectorTickets } from "../ia/lectorTickets.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { cobrarInvitado, fijarPrecioInvitado, obtenerOCrearSabado } from "../sabados/sabados.js";
import { subirTicket } from "../tickets/tickets.js";
import { anularAsiento, saldoDeCuenta, saldoDisponible, type ActorAdmin } from "./libro.js";
import {
  confirmarTraspaso,
  controlarCaja,
  depositarEfectivo,
  efectivoDe,
  gastoGeneral,
  iniciarTraspaso,
  listarMovimientos,
  rechazarOCancelarTraspaso,
  saldosCaja,
  traspasosPendientes,
  ultimoControl,
} from "./operaciones.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let juan: ActorAdmin;
let tomas: ActorAdmin;
let sabadoId: string;

const cobrarEfectivo = (actor: ActorAdmin) => cobrarInvitado(conexion.db, actor, { sabadoId, medio: "EFECTIVO" });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const j = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  juan = { tipo: "ADMIN", adminId: j.id, rol: "ADMIN" };
  const t = await crearAdmin(conexion.db, dueno, { nombre: "Tomás", email: "t@ejemplo.com", contrasena: "clave-de-tomas-1" });
  tomas = { tipo: "ADMIN", adminId: t.id, rol: "ADMIN" };
  await fijarPrecioInvitado(conexion.db, dueno, 1_500_000n);
  sabadoId = (await obtenerOCrearSabado(conexion.db, "2026-11-21")).id;
});

afterAll(async () => {
  await conexion.cerrar();
});

describe("dónde está la plata", () => {
  it("arranca en cero y muestra cuenta, efectivo por persona y camadas", async () => {
    expect((await saldosCaja(conexion.db)).totalCentavos).toBe(0n);
    await cobrarEfectivo(juan);
    await cobrarInvitado(conexion.db, juan, { sabadoId, medio: "TRANSFERENCIA" });
    const sabadoLocal = await obtenerOCrearSabado(conexion.db, "2026-11-28");
    const { cocina } = await crearCocina(conexion.db, juan, { sabadoId: sabadoLocal.id, camada: "2015", responsableNombre: "Agus" });
    await adelantar(conexion.db, juan, { cocinaId: cocina.id, montoCentavos: 1_000_000n, medio: "TRANSFERENCIA" });

    const s = await saldosCaja(conexion.db);
    expect(s.totalCentavos).toBe(3_000_000n);
    expect(s.cuentaCentavos).toBe(500_000n);
    expect(s.efectivo).toEqual([{ adminId: juan.adminId, nombre: "Juan", centavos: 1_500_000n }]);
    expect(s.camadas).toHaveLength(1);
    expect(s.camadas[0]).toMatchObject({ camada: "2015", centavos: 1_000_000n });
    expect(s.cuentaCentavos + s.efectivo.reduce((t, e) => t + e.centavos, 0n) + s.camadas.reduce((t, c) => t + c.centavos, 0n)).toBe(s.totalCentavos);
  });
});

describe("efectivo con responsable", () => {
  it("depositar en el alias pasa la plata a la cuenta; no se puede depositar más de lo que se tiene", async () => {
    const efectivoAntes = await efectivoDe(conexion.db, juan.adminId);
    const cuentaAntes = await saldoDeCuenta(conexion.db, "CUENTA");
    await expect(depositarEfectivo(conexion.db, juan, { montoCentavos: efectivoAntes + 1n })).rejects.toThrow("No tenés tanto efectivo");
    await depositarEfectivo(conexion.db, juan, { montoCentavos: 500_000n });
    expect(await efectivoDe(conexion.db, juan.adminId)).toBe(efectivoAntes - 500_000n);
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(cuentaAntes + 500_000n);
  });

  it("al entregar efectivo, recién pasa al otro cuando confirma", async () => {
    await cobrarEfectivo(juan);
    const juanAntes = await efectivoDe(conexion.db, juan.adminId);
    const traspaso = await iniciarTraspaso(conexion.db, juan, { paraAdminId: dueno.adminId, montoCentavos: 1_000_000n, nota: "Lo del sábado" });
    expect(await efectivoDe(conexion.db, juan.adminId)).toBe(juanAntes);
    expect((await traspasosPendientes(conexion.db, dueno.adminId)).map((t) => t.id)).toContain(traspaso.id);
    await expect(confirmarTraspaso(conexion.db, juan, traspaso.id)).rejects.toThrow("Solo puede confirmarlo quien recibe");
    await confirmarTraspaso(conexion.db, dueno, traspaso.id);
    expect(await efectivoDe(conexion.db, juan.adminId)).toBe(juanAntes - 1_000_000n);
    expect(await efectivoDe(conexion.db, dueno.adminId)).toBe(1_000_000n);
    await expect(confirmarTraspaso(conexion.db, dueno, traspaso.id)).rejects.toThrow("ya se resolvió");
  });

  it("si el que recibe lo rechaza (o el que entrega lo cancela), la plata sigue con el que la tenía", async () => {
    await cobrarEfectivo(tomas);
    const t1 = await iniciarTraspaso(conexion.db, tomas, { paraAdminId: juan.adminId, montoCentavos: 1_000_000n });
    await rechazarOCancelarTraspaso(conexion.db, juan, t1.id);
    const t2 = await iniciarTraspaso(conexion.db, tomas, { paraAdminId: juan.adminId, montoCentavos: 1_000_000n });
    await expect(rechazarOCancelarTraspaso(conexion.db, dueno, t2.id)).rejects.toThrow("Solo quien entrega o quien recibe");
    const cancelado = await rechazarOCancelarTraspaso(conexion.db, tomas, t2.id);
    expect(cancelado?.estado).toBe("CANCELADO");
    expect(await efectivoDe(conexion.db, tomas.adminId)).toBe(1_500_000n);
  });

  it("no se puede entregar más de lo que se tiene, ni confirmar si en el medio ya no lo tiene", async () => {
    const tiene = await efectivoDe(conexion.db, tomas.adminId);
    await expect(iniciarTraspaso(conexion.db, tomas, { paraAdminId: juan.adminId, montoCentavos: tiene + 1n })).rejects.toThrow("No tenés tanto");
    const t = await iniciarTraspaso(conexion.db, tomas, { paraAdminId: juan.adminId, montoCentavos: tiene });
    await depositarEfectivo(conexion.db, tomas, { montoCentavos: tiene });
    await expect(confirmarTraspaso(conexion.db, juan, t.id)).rejects.toThrow("ya no tiene ese efectivo");
  });

  it("la base no deja cambiar el monto de un traspaso ni reabrir uno resuelto", async () => {
    await cobrarEfectivo(tomas);
    const t = await iniciarTraspaso(conexion.db, tomas, { paraAdminId: juan.adminId, montoCentavos: 1_500_000n });
    await expect(conexion.db.update(traspasosEfectivo).set({ montoCentavos: 1n }).where(eq(traspasosEfectivo.id, t.id))).rejects.toThrow();
    await rechazarOCancelarTraspaso(conexion.db, juan, t.id);
    await expect(conexion.db.update(traspasosEfectivo).set({ estado: "PENDIENTE" }).where(eq(traspasosEfectivo.id, t.id))).rejects.toThrow();
    await expect(conexion.db.delete(traspasosEfectivo).where(eq(traspasosEfectivo.id, t.id))).rejects.toThrow();
  });
});

describe("gastos que no son de un sábado", () => {
  const hielo = [{ descripcion: "Hielo", cantidad: "10 bolsas", categoria: "INSUMOS" as const, subtotalCentavos: 400_000n }];

  it("desde la cuenta baja la cuenta y suma en el egreso de su categoría", async () => {
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    await gastoGeneral(conexion.db, juan, { desde: "CUENTA", proveedor: "Hielería", items: hielo });
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(antes - 400_000n);
    expect(await saldoDeCuenta(conexion.db, "EGRESO:INSUMOS")).toBeGreaterThanOrEqual(400_000n);
  });

  it("desde el efectivo propio, solo hasta lo que se tiene", async () => {
    const tiene = await efectivoDe(conexion.db, juan.adminId);
    await expect(
      gastoGeneral(conexion.db, juan, { desde: "EFECTIVO", items: [{ descripcion: "Carbón", categoria: "INSUMOS", subtotalCentavos: tiene + 1n }] }),
    ).rejects.toThrow("No tenés tanto");
  });

  it("con foto de ticket leída por IA, sale de la cuenta elegida", async () => {
    const lectura: LecturaTicket = {
      es_ticket: true, legible: true, proveedor: "Distribuidora", fecha: null, total_centavos: 600_000,
      items: [{ descripcion: "Gaseosas", cantidad: "6", categoria: "BEBIDAS", importe_centavos: 600_000 }], observaciones: null,
    };
    const lector: LectorTickets = async () => lectura;
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(Math.random()))]);
    const r = await subirTicket(conexion.db, lector, juan, { contenido: foto, destino: { tipo: "CAJA", cuentaOrigenCodigo: "CUENTA" } });
    expect(r.estado).toBe("REGISTRADO");
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(antes - 600_000n);
  });
});

describe("control contra la reserva real", () => {
  it("solo el dueño; sin diferencia no ajusta nada", async () => {
    const libro = await saldoDeCuenta(conexion.db, "CUENTA");
    await expect(controlarCaja(conexion.db, juan, { declaradoCentavos: libro, ajustar: false })).rejects.toThrow("Solo el dueño");
    const c = await controlarCaja(conexion.db, dueno, { declaradoCentavos: libro, ajustar: false });
    expect(c.diferenciaCentavos).toBe(0n);
    expect(c.ajusteAsientoId).toBeNull();
  });

  it("con diferencia, muestra cuánto y, si el dueño ajusta con motivo, la cuenta queda igual a la reserva", async () => {
    const libro = await saldoDeCuenta(conexion.db, "CUENTA");
    const declarado = libro - 250_000n;
    const soloMirar = await controlarCaja(conexion.db, dueno, { declaradoCentavos: declarado, ajustar: false });
    expect(soloMirar.diferenciaCentavos).toBe(-250_000n);
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(libro);
    await expect(controlarCaja(conexion.db, dueno, { declaradoCentavos: declarado, ajustar: true })).rejects.toThrow("motivo");
    const ajustado = await controlarCaja(conexion.db, dueno, { declaradoCentavos: declarado, ajustar: true, motivo: "Comisión no registrada" });
    expect(ajustado.ajusteAsientoId).not.toBeNull();
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(declarado);
    expect(await saldoDeCuenta(conexion.db, "EGRESO:AJUSTES")).toBe(250_000n);
    expect((await ultimoControl(conexion.db))?.id).toBe(ajustado.id);
    await expect(conexion.db.delete(controlesCaja)).rejects.toThrow();
  });
});

describe("lista de movimientos", () => {
  it("clasifica entradas, salidas e internos y marca los anulados", async () => {
    const movimientos = await listarMovimientos(conexion.db, { limite: 200 });
    const tipos = new Set(movimientos.map((m) => m.tipo));
    expect(tipos).toEqual(new Set(["ENTRADA", "SALIDA", "INTERNO"]));
    const depositos = movimientos.filter((m) => m.descripcion.startsWith("Depósito de efectivo"));
    expect(depositos.every((d) => d.tipo === "INTERNO")).toBe(true);
    expect(depositos.map((d) => d.montoCentavos)).toContain(500_000n);

    const cobro = await cobrarEfectivo(juan);
    await conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId: cobro.asientoId, motivo: "Prueba de anulación" }));
    const despues = await listarMovimientos(conexion.db);
    expect(despues.find((m) => m.id === cobro.asientoId)?.anulado).toBe(true);
    expect(await saldoDisponible(conexion.db)).toBe((await saldosCaja(conexion.db)).totalCentavos);
  });
});
