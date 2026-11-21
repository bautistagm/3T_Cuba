import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDueno } from "../admins/admins.js";
import type { ConexionBase } from "../db/cliente.js";
import { anularGasto } from "../gastos/gastos.js";
import type { AsistenteIa } from "../ia/asistente.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { cobrarInvitado, fijarPrecioInvitado, obtenerOCrearSabado } from "../sabados/sabados.js";
import { datosDelMes, explicarMes, gastosPorMes, preguntarSobreLaPlata, productosQueMasGastan, ultimosMeses } from "./analisis.js";
import type { ActorAdmin } from "./libro.js";
import { gastoGeneral } from "./operaciones.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
const [mesActual, mesAnterior] = [ultimosMeses(1)[0] ?? "", ultimosMeses(2)[0] ?? ""];
const fechaEn = (mes: string) => new Date(`${mes}-10T15:00:00-03:00`);

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  // Para tener plata en la cuenta.
  await fijarPrecioInvitado(conexion.db, dueno, 10_000_000n);
  const s = await obtenerOCrearSabado(conexion.db, "2026-11-21");
  for (let i = 0; i < 5; i++) await cobrarInvitado(conexion.db, dueno, { sabadoId: s.id, medio: "TRANSFERENCIA", nombre: "Pedro Secreto" });

  await gastoGeneral(conexion.db, dueno, { desde: "CUENTA", fecha: fechaEn(mesAnterior), items: [
    { descripcion: "Vacío", categoria: "CARNE", subtotalCentavos: 10_000_000n },
    { descripcion: "Cerveza", categoria: "BEBIDAS", subtotalCentavos: 5_000_000n },
  ] });
  await gastoGeneral(conexion.db, dueno, { desde: "CUENTA", fecha: fechaEn(mesActual), items: [
    { descripcion: "VACÍO ", categoria: "CARNE", subtotalCentavos: 20_000_000n },
    { descripcion: "Hielo", categoria: "INSUMOS", subtotalCentavos: 1_000_000n },
  ] });
  const anulado = await gastoGeneral(conexion.db, dueno, { desde: "CUENTA", fecha: fechaEn(mesActual), items: [
    { descripcion: "Error", categoria: "OTROS", subtotalCentavos: 9_000_000n },
  ] });
  await anularGasto(conexion.db, dueno, anulado.id, "Cargado por error");
});

afterAll(async () => {
  await conexion.cerrar();
});

describe("meses", () => {
  it("cuenta hacia atrás cruzando el año", () => {
    expect(ultimosMeses(3, new Date("2027-01-15T12:00:00-03:00"))).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(ultimosMeses(1, new Date("2027-01-01T01:00:00Z"))).toEqual(["2026-12"]); // todavía es 31/12 en Argentina
  });
});

describe("gastos por mes", () => {
  it("separa por mes y categoría, y no cuenta los anulados", async () => {
    const meses = await gastosPorMes(conexion.db, 12);
    expect(meses).toHaveLength(12);
    const actual = meses.find((m) => m.mes === mesActual);
    const anterior = meses.find((m) => m.mes === mesAnterior);
    expect(actual?.totalCentavos).toBe(21_000_000n);
    expect(actual?.porCategoria.OTROS).toBe(0n);
    expect(anterior?.porCategoria).toMatchObject({ CARNE: 10_000_000n, BEBIDAS: 5_000_000n });
  });

  it("agrupa productos con el mismo nombre aunque estén escritos distinto", async () => {
    const productos = await productosQueMasGastan(conexion.db, 6, 10);
    expect(productos[0]).toMatchObject({ producto: "Vacío", totalCentavos: 30_000_000n, veces: 2 });
    expect(productos.find((p) => p.producto === "Error")).toBeUndefined();
  });

  it("los datos del mes comparan con el promedio anterior", async () => {
    const datos = await datosDelMes(conexion.db, mesActual);
    expect(datos.totalCentavos).toBe(21_000_000n);
    expect(datos.promedioMesesAnterioresCentavos).toBe(15_000_000n);
    await expect(datosDelMes(conexion.db, "2026-13")).rejects.toThrow("no es válido");
  });
});

describe("IA", () => {
  it("a la IA le llegan solo números (nunca nombres de jugadores o invitados)", async () => {
    const recibido: string[] = [];
    const asistente: AsistenteIa = async (instrucciones, datos, pregunta) => {
      recibido.push(JSON.stringify(datos), instrucciones, pregunta);
      return "Respuesta de prueba";
    };
    expect(await explicarMes(conexion.db, asistente, mesActual)).toBe("Respuesta de prueba");
    expect(await preguntarSobreLaPlata(conexion.db, asistente, "¿En qué gastamos más este año?")).toBe("Respuesta de prueba");
    const todo = recibido.join(" ");
    expect(todo).not.toContain("Pedro Secreto");
    expect(todo).not.toContain("b@ejemplo.com");
    expect(todo).toContain("Vacío");
  });

  it("valida la pregunta", async () => {
    const asistente: AsistenteIa = async () => "x";
    await expect(preguntarSobreLaPlata(conexion.db, asistente, "?")).rejects.toThrow("más larga");
    await expect(preguntarSobreLaPlata(conexion.db, asistente, "x".repeat(301))).rejects.toThrow("muy larga");
  });
});
