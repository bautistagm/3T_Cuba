import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import { saldoDeCuenta } from "../caja/libro.js";
import { abrirMes, fijarAlias } from "../cuotas/cuotas.js";
import type { ConexionBase } from "../db/cliente.js";
import { comprasEntradas, entradas } from "../db/esquema.js";
import { crearJugador, datosJugadorSchema } from "../jugadores/jugadores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { anularPago } from "../sabados/sabados.js";
import type { EntradaCuenta } from "../verificacion/cruce.js";
import { asignarACompra, fijarFechaCorte, leerCuenta, transferenciasParaRevisar } from "../verificacion/transferencias.js";
import {
  anularCompraPendiente,
  cambiarEstadoVenta,
  crearCompra,
  crearFiesta,
  detalleFiesta,
  estadoDeCompra,
  fiestaParaComprar,
  listaEnCsv,
  listarFiestas,
} from "./fiestas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let fiestaId = "";
let linkMujer = "";
let linkHombre = "";
let cuenta: EntradaCuenta[] = [];
const buscar = async () => cuenta;
const ahora = new Date();
let n = 5000;
const transferencia = (dni: string, pesos: number): EntradaCuenta => ({
  mpPagoId: String(++n),
  e2eId: null,
  montoCentavos: BigInt(pesos) * 100n,
  fecha: new Date(ahora.getTime() - 60_000),
  cuitPagador: `27${dni.padStart(8, "0")}4`,
});
const leer = () => leerCuenta(conexion.db, buscar, { ahora });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  await fijarAlias(conexion.db, dueno, "plantel.cuba.3t");
  await fijarFechaCorte(conexion.db, dueno, "2026-01-01");
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("fiestas", () => {
  it("solo el dueño crea la fiesta; cada tipo tiene su link de venta", async () => {
    const datos = { nombre: "Fiesta de fin de año", fechaHora: new Date(Date.now() + 10 * 86_400_000), lugar: "Club", tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }, { nombre: "Hombre", precioCentavos: 1500000n }] };
    await expect(crearFiesta(conexion.db, admin, datos)).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    fiestaId = (await crearFiesta(conexion.db, dueno, datos)).id;
    const d = await detalleFiesta(conexion.db, fiestaId, dueno);
    [linkMujer, linkHombre] = d.tipos.map((t) => t.tokenVenta) as [string, string];
    expect(d.fiesta.tokenPuerta).toBeTruthy();
    expect((await detalleFiesta(conexion.db, fiestaId, admin)).fiesta.tokenPuerta).toBeNull();
    expect(await fiestaParaComprar(conexion.db, linkMujer)).toMatchObject({ tipo: { nombre: "Mujer", precioCentavos: 1000000n }, abierta: true, alias: "plantel.cuba.3t" });
  });

  it("compra pública: valida los DNI; si ya hay una pendiente, devuelve esa", async () => {
    await expect(crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Ana Pérez", dni: "123" }], email: "ana@ejemplo.com" })).rejects.toMatchObject({ codigo: "DNI_INVALIDO" });
    await expect(
      crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }, { nombre: "Otra", dni: "40.111.222" }], email: "ana@ejemplo.com" }),
    ).rejects.toMatchObject({ codigo: "DNI_REPETIDO" });
    const c = await crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Ana Pérez", dni: "40.111.222" }, { nombre: "Bea Gómez", dni: "41222333" }], email: "ana@ejemplo.com" });
    expect(c).toMatchObject({ cantidad: 2, totalCentavos: 2000000n, dniPagador: "40111222", existente: false });
    const otra = await crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }], email: "ana@ejemplo.com" });
    expect(otra).toMatchObject({ codigoConsulta: c.codigoConsulta, existente: true });
    expect((await estadoDeCompra(conexion.db, c.codigoConsulta)).entradas.every((e) => e.codigo === null)).toBe(true);
  });

  it("la transferencia de quien compra por el total exacto confirma la compra sola y la cuenta en la caja", async () => {
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    cuenta = [transferencia("40111222", 20000)];
    expect(await leer()).toMatchObject({ nuevas: 1, confirmadas: 1 });
    const [compra] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.dniPagador, "40111222"));
    const estado = await estadoDeCompra(conexion.db, compra?.codigoConsulta ?? "");
    expect(estado.estado).toBe("PAGADA");
    expect(estado.entradas.every((e) => e.estado === "VALIDA" && e.codigo && e.codigo.length >= 20)).toBe(true);
    expect((await saldoDeCuenta(conexion.db, "CUENTA")) - antes).toBe(2000000n);
    expect((await listarFiestas(conexion.db))[0]).toMatchObject({ vendidas: 2, pendientes: 0 });
  });

  it("no deja comprar otra entrada para un DNI que ya tiene", async () => {
    await expect(crearCompra(conexion.db, linkHombre, { entradas: [{ nombre: "Bea Gómez", dni: "41222333" }], email: "b@ejemplo.com" })).rejects.toMatchObject({ codigo: "YA_TIENE_ENTRADA" });
  });

  it("monto equivocado: a Revisar con el motivo; el dueño la asigna a la compra correcta", async () => {
    const c = await crearCompra(conexion.db, linkHombre, { entradas: [{ nombre: "Carlos Ruiz", dni: "42333444" }], email: "c@ejemplo.com" });
    cuenta = [transferencia("42333444", 14000)];
    await leer();
    const [r] = await transferenciasParaRevisar(conexion.db);
    expect(r?.motivo).toBe("Ese DNI tiene una compra de entradas pendiente por $15.000, pero transfirió $14.000.");
    // La paga otra persona por el monto justo: tampoco se adivina.
    cuenta = [transferencia("30999888", 15000)];
    await leer();
    const deOtro = (await transferenciasParaRevisar(conexion.db)).find((t) => t.montoCentavos === 1500000n);
    const [compra] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.codigoConsulta, c.codigoConsulta));
    await asignarACompra(conexion.db, dueno, deOtro?.mpPagoId ?? "", compra?.id ?? "");
    expect((await estadoDeCompra(conexion.db, c.codigoConsulta)).estado).toBe("PAGADA");
  });

  it("si el DNI es de un jugador que también debe ese monto, decide el dueño", async () => {
    const j = await crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre: "Dario", apellido: "Prueba", dni: "43444555" }));
    await abrirMes(conexion.db, dueno, { anio: 2030, mes: 1, montoCentavos: 1000000n });
    await crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Dario Prueba", dni: "43444555" }], email: "d@ejemplo.com" });
    cuenta = [transferencia("43444555", 10000)];
    await leer();
    const r = (await transferenciasParaRevisar(conexion.db)).find((t) => t.dniPagador === "43444555");
    expect(r?.motivo).toBe("Puede ser la cuota de Dario Prueba o su compra de entradas: decidí vos.");
    expect(r?.jugadorSugerido?.id).toBe(j.id);
  });

  it("anular el pago anula la compra y sus entradas; anular una compra sin pagar es del dueño", async () => {
    const [pagada] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.dniPagador, "40111222"));
    await anularPago(conexion.db, dueno, pagada?.pagoId ?? "", "Pidió la devolución");
    expect((await estadoDeCompra(conexion.db, pagada?.codigoConsulta ?? "")).entradas.every((e) => e.estado === "ANULADA" && e.codigo === null)).toBe(true);
    const [pendiente] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.dniPagador, "43444555"));
    await expect(anularCompraPendiente(conexion.db, admin, pendiente?.id ?? "")).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await anularCompraPendiente(conexion.db, dueno, pendiente?.id ?? "");
    await expect(conexion.db.update(entradas).set({ estado: "VALIDA" }).where(eq(entradas.compraId, pendiente?.id ?? ""))).rejects.toThrow();
  });

  it("venta cerrada y lista para descargar", async () => {
    await cambiarEstadoVenta(conexion.db, dueno, fiestaId, false);
    await expect(crearCompra(conexion.db, linkMujer, { entradas: [{ nombre: "Eva Luna", dni: "44555666" }], email: "e@ejemplo.com" })).rejects.toMatchObject({ codigo: "VENTA_CERRADA" });
    const csv = listaEnCsv(await detalleFiesta(conexion.db, fiestaId, dueno));
    expect(csv.split("\n")[0]).toBe("Tipo,Nombre,DNI,Estado,Email,Teléfono");
    expect(csv).toContain('"Hombre","Carlos Ruiz","42333444","Pagada"');
  });
});
