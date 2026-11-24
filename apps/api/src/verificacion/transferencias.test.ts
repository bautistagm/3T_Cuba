import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDueno, crearAdmin } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import { saldoDeCuenta } from "../caja/libro.js";
import { abrirMes, cuotasDeJugador } from "../cuotas/cuotas.js";
import type { ConexionBase } from "../db/cliente.js";
import { transferenciasRecibidas } from "../db/esquema.js";
import { crearJugador, darDeBaja, datosJugadorSchema } from "../jugadores/jugadores.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { anularPago } from "../sabados/sabados.js";
import type { EntradaCuenta } from "./cruce.js";
import {
  asignarAJugador,
  fijarFechaCorte,
  leerCuenta,
  marcarNoEsDelPlantel,
  marcarYaRegistrada,
  registrarOtroIngreso,
  transferenciasParaRevisar,
  ultimasTransferencias,
} from "./transferencias.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let cuenta: EntradaCuenta[] = [];
const buscar = async (desde: Date, hasta: Date) => cuenta.filter((e) => e.fecha >= desde && e.fecha <= hasta);
const ahora = new Date("2027-02-10T12:00:00-03:00");
const leer = () => leerCuenta(conexion.db, buscar, { ahora });
let n = 1000;
/** Una transferencia de un CUIL con el DNI dado (datos inventados). */
const transferencia = (dni: string | null, pesos: number, fecha = "2027-02-10T11:00:00-03:00"): EntradaCuenta => ({
  mpPagoId: String(++n),
  e2eId: null,
  montoCentavos: BigInt(pesos) * 100n,
  fecha: new Date(fecha),
  cuitPagador: dni ? `20${dni.padStart(8, "0")}5` : null,
});
let mateo: { id: string };
let lucas: { id: string };

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  const alta = (nombre: string, dni: string) => crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre, apellido: "Prueba", dni }));
  mateo = await alta("Mateo", "44000001");
  lucas = await alta("Lucas", "44000002");
  await alta("Tomi", "7123456"); // DNI de 7 números
  await abrirMes(conexion.db, dueno, { anio: 2027, mes: 1, montoCentavos: 3000000n });
  await abrirMes(conexion.db, dueno, { anio: 2027, mes: 2, montoCentavos: 3500000n });
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("lectura automática de la cuenta", () => {
  it("sin fecha de corte no lee nada", async () => {
    cuenta = [transferencia("44000001", 30000)];
    expect(await leer()).toMatchObject({ estado: "SIN_CONFIGURAR" });
    expect(await leerCuenta(conexion.db, null)).toMatchObject({ estado: "SIN_CONFIGURAR" });
    await expect(fijarFechaCorte(conexion.db, admin, "2027-02-01")).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await fijarFechaCorte(conexion.db, dueno, "2027-02-01");
  });

  it("reconoce sola la cuota más vieja por el DNI y la registra en la caja", async () => {
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    const r = await leer();
    expect(r).toMatchObject({ estado: "LEIDA", nuevas: 1, confirmadas: 1, paraRevisar: 0 });
    const cuotas = (await cuotasDeJugador(conexion.db, mateo.id)).cuotas;
    expect(cuotas.map((c) => `${c.mes}:${c.estado}`)).toEqual(["Febrero 2027:PENDIENTE", "Enero 2027:PAGADO"]);
    expect((await saldoDeCuenta(conexion.db, "CUENTA")) - antes).toBe(3000000n);
  });

  it("leer de nuevo no repite nada", async () => {
    expect(await leer()).toMatchObject({ nuevas: 0 });
  });

  it("la suma exacta de varios meses también; el DNI de 7 números también", async () => {
    cuenta.push(transferencia("44000002", 65000), transferencia("7123456", 30000));
    expect(await leer()).toMatchObject({ nuevas: 2, confirmadas: 2 });
    expect((await cuotasDeJugador(conexion.db, lucas.id)).cuotas.every((c) => c.estado === "PAGADO")).toBe(true);
  });

  it("lo anterior a la fecha de corte se ignora (no se guarda)", async () => {
    const vieja = transferencia("44000001", 35000, "2027-01-20T10:00:00-03:00");
    cuenta.push(vieja);
    await leer();
    expect(await conexion.db.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, vieja.mpPagoId))).toHaveLength(0);
  });

  it("lo dudoso va a Revisar con el motivo", async () => {
    cuenta.push(
      transferencia("30111222", 35000), // DNI de nadie (pagó desde otra cuenta)
      transferencia("44000001", 20000), // DNI de Mateo, monto que no cierra
      transferencia(null, 35000), // sin CUIL
    );
    expect(await leer()).toMatchObject({ nuevas: 3, confirmadas: 0, paraRevisar: 3 });
    const revisar = await transferenciasParaRevisar(conexion.db);
    expect(revisar.map((t) => t.motivo)).toEqual([
      "El DNI no es de ningún jugador ni de una compra de entradas. ¿Pagó desde la cuenta de otra persona?",
      "Es de Mateo Prueba, pero transfirió $20.000 y debe $35.000 (1 cuota).",
      "No trae un CUIL/CUIT válido de quien transfirió.",
    ]);
    expect(revisar[1]?.jugadorSugerido?.id).toBe(mateo.id);
  });

  it("un jugador de baja va a Revisar", async () => {
    const caro = await crearJugador(conexion.db, dueno, datosJugadorSchema.parse({ nombre: "Caro", apellido: "Prueba", dni: "44000009" }));
    await darDeBaja(conexion.db, dueno, caro.id);
    cuenta.push(transferencia("44000009", 30000));
    await leer();
    expect((await transferenciasParaRevisar(conexion.db)).some((t) => t.motivo?.includes("está de baja"))).toBe(true);
  });
});

describe("Revisar: el dueño dice de quién es", () => {
  it("es de un jugador: las cuotas elegidas tienen que sumar exacto; solo el dueño", async () => {
    const [deOtraCuenta] = await transferenciasParaRevisar(conexion.db);
    const febrero = (await cuotasDeJugador(conexion.db, mateo.id)).cuotas.find((c) => c.estado === "PENDIENTE");
    await expect(asignarAJugador(conexion.db, admin, deOtraCuenta?.mpPagoId ?? "", mateo.id, [febrero?.id ?? ""])).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    const pago = await asignarAJugador(conexion.db, dueno, deOtraCuenta?.mpPagoId ?? "", mateo.id, [febrero?.id ?? ""]);
    expect(pago.montoCentavos).toBe(3500000n);
    await expect(asignarAJugador(conexion.db, dueno, deOtraCuenta?.mpPagoId ?? "", mateo.id, [febrero?.id ?? ""])).rejects.toMatchObject({ codigo: "YA_RESUELTA" });
  });

  it("si las cuotas no suman lo transferido, no deja (no hay pagos parciales)", async () => {
    const corta = (await transferenciasParaRevisar(conexion.db)).find((t) => t.montoCentavos === 2000000n);
    const tomi = await conexion.db.query.jugadores.findFirst({ where: (j, { eq: igual }) => igual(j.dni, "7123456") });
    const pendiente = (await cuotasDeJugador(conexion.db, tomi?.id ?? "")).cuotas.find((c) => c.estado === "PENDIENTE");
    await expect(asignarAJugador(conexion.db, dueno, corta?.mpPagoId ?? "", tomi?.id ?? "", [pendiente?.id ?? ""])).rejects.toMatchObject({ codigo: "MONTO_DISTINTO" });
  });

  it("ya registrada, otro ingreso o no es del plantel", async () => {
    const pendientes = await transferenciasParaRevisar(conexion.db);
    const antes = await saldoDeCuenta(conexion.db, "CUENTA");
    await marcarYaRegistrada(conexion.db, dueno, pendientes[0]?.mpPagoId ?? "", "Depósito de Juan del sábado");
    await registrarOtroIngreso(conexion.db, dueno, pendientes[1]?.mpPagoId ?? "", "Donación de un ex jugador");
    await expect(marcarNoEsDelPlantel(conexion.db, dueno, pendientes[2]?.mpPagoId ?? "", "")).rejects.toMatchObject({ codigo: "FALTA_NOTA" });
    await marcarNoEsDelPlantel(conexion.db, dueno, pendientes[2]?.mpPagoId ?? "", "Me la mandó mi vieja");
    // Solo el "otro ingreso" suma a la caja.
    expect((await saldoDeCuenta(conexion.db, "CUENTA")) - antes).toBe(pendientes[1]?.montoCentavos);
    expect(await transferenciasParaRevisar(conexion.db)).toHaveLength(0);
  });

  it("si se anula un pago que vino de una transferencia, la transferencia vuelve a Revisar", async () => {
    const auto = (await ultimasTransferencias(conexion.db, 3650)).find((t) => t.resolucion === "CUOTA_AUTO" && t.jugador === "Mateo Prueba");
    const [fila] = await conexion.db.select().from(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, auto?.mpPagoId ?? ""));
    await anularPago(conexion.db, dueno, fila?.pagoId ?? "", "Era de otro jugador");
    const revisar = await transferenciasParaRevisar(conexion.db);
    expect(revisar.map((t) => t.mpPagoId)).toContain(auto?.mpPagoId);
    // Y la cuota volvió a quedar pendiente.
    expect((await cuotasDeJugador(conexion.db, mateo.id)).cuotas.find((c) => c.mes === "Enero 2027")?.estado).toBe("PENDIENTE");
  });

  it("la base no deja cambiar los datos de una transferencia ni borrarla", async () => {
    const [una] = await conexion.db.select().from(transferenciasRecibidas).limit(1);
    await expect(conexion.db.update(transferenciasRecibidas).set({ montoCentavos: 1n }).where(eq(transferenciasRecibidas.mpPagoId, una?.mpPagoId ?? ""))).rejects.toThrow();
    await expect(conexion.db.delete(transferenciasRecibidas).where(eq(transferenciasRecibidas.mpPagoId, una?.mpPagoId ?? ""))).rejects.toThrow();
  });

  it("la fecha de corte no se mueve hacia atrás una vez leídas transferencias", async () => {
    await expect(fijarFechaCorte(conexion.db, dueno, "2027-01-01")).rejects.toMatchObject({ codigo: "CORTE_HACIA_ATRAS" });
  });
});
