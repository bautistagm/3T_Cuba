import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, saldoDisponible, type ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { gastoItems, gastos } from "../db/esquema.js";
import { anularGasto, type ItemGasto } from "../gastos/gastos.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { obtenerOCrearSabado } from "../sabados/sabados.js";
import {
  adelantar,
  anularMovimientoCocina,
  cerrarCocina,
  cocinaPorToken,
  codigoCuentaCocina,
  crearCocina,
  gastoDeCocina,
  regenerarLink,
  resumenCocina,
} from "./cocina.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let semana = 0;

/** Cada test usa un sábado distinto. */
async function nuevaCocina() {
  const fecha = new Date(Date.UTC(2027, 0, 2 + 7 * semana++)).toISOString().slice(0, 10);
  const sabado = await obtenerOCrearSabado(conexion.db, fecha);
  return crearCocina(conexion.db, admin, { sabadoId: sabado.id, camada: "2015", responsableNombre: "Agustín", responsableTelefono: "11 5555-5555" });
}

const carniceria: ItemGasto[] = [
  { descripcion: "Vacío", cantidad: "15 kg", categoria: "CARNE", subtotalCentavos: 12_000_000n },
  { descripcion: "Chorizo", cantidad: "8 kg", categoria: "CARNE", subtotalCentavos: 4_400_000n },
];
const supermercado: ItemGasto[] = [
  { descripcion: "Pan", categoria: "INSUMOS", subtotalCentavos: 3_600_000n },
  { descripcion: "Gaseosas", categoria: "BEBIDAS", subtotalCentavos: 2_000_000n },
];

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

describe("asignar la cocina", () => {
  it("crea la cocina, marca el sábado de local y da un link que funciona", async () => {
    const { cocina, token } = await nuevaCocina();
    expect(token.length).toBeGreaterThan(20);
    expect((await cocinaPorToken(conexion.db, token))?.id).toBe(cocina.id);
    expect(await cocinaPorToken(conexion.db, "token-inventado-que-no-existe")).toBeNull();
    expect(JSON.stringify(cocina)).not.toContain(token);
  });

  it("un sábado tiene una sola cocina", async () => {
    const { cocina } = await nuevaCocina();
    await expect(
      crearCocina(conexion.db, admin, { sabadoId: cocina.sabadoId, camada: "2016", responsableNombre: "Otro" }),
    ).rejects.toThrow("ya tiene una camada");
  });

  it("al regenerar el link, el anterior deja de funcionar", async () => {
    const { cocina, token } = await nuevaCocina();
    const nuevo = await regenerarLink(conexion.db, admin, cocina.id);
    expect(await cocinaPorToken(conexion.db, token)).toBeNull();
    expect((await cocinaPorToken(conexion.db, nuevo))?.id).toBe(cocina.id);
  });
});

describe("la plata de la cocina", () => {
  it("adelanto, gastos producto por producto y saldo: todo sale de la caja y cierra", async () => {
    const { cocina } = await nuevaCocina();
    const disponibleAntes = await saldoDisponible(conexion.db);
    const cuentaAntes = await saldoDeCuenta(conexion.db, "CUENTA");

    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 25_000_000n, medio: "TRANSFERENCIA" });
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 5_000_000n, medio: "TRANSFERENCIA", nota: "Pidieron más" });
    // Pasar plata a la camada no cambia la plata total del plantel: solo cambia de lugar.
    expect(await saldoDisponible(conexion.db)).toBe(disponibleAntes);
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(cuentaAntes - 30_000_000n);

    const g1 = await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, proveedor: "Carnicería", origenCarga: "MANUAL", items: carniceria });
    await gastoDeCocina(conexion.db, { tipo: "PUBLICO" }, { cocinaId: cocina.id, proveedor: "Súper", origenCarga: "MANUAL", items: supermercado });
    expect(g1.totalCentavos).toBe(16_400_000n);
    expect(g1.items).toHaveLength(2);

    const r = await resumenCocina(conexion.db, cocina.id);
    expect(r.adelantadoCentavos).toBe(30_000_000n);
    expect(r.gastadoCentavos).toBe(22_000_000n);
    expect(r.saldoCentavos).toBe(8_000_000n);
    expect(r.gastos).toHaveLength(2);
    // Lo que se gastó sí bajó la plata del plantel.
    expect(await saldoDisponible(conexion.db)).toBe(disponibleAntes - 22_000_000n);
    // Los egresos quedaron por categoría.
    expect(await saldoDeCuenta(conexion.db, "EGRESO:CARNE")).toBeGreaterThanOrEqual(16_400_000n);
  });

  it("cerrar con sobrante devuelto por transferencia deja la cuenta de la cocina en cero", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    const cuentaAntes = await saldoDeCuenta(conexion.db, "CUENTA");
    await expect(cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "REINTEGRO_TRANSFERENCIA" })).rejects.toThrow("no corresponde");
    const cerrada = await cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "DEVOLUCION_TRANSFERENCIA" });
    expect(cerrada?.estado).toBe("CERRADA");
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(0n);
    expect(await saldoDeCuenta(conexion.db, "CUENTA")).toBe(cuentaAntes + 3_600_000n);
  });

  it("cerrar con sobrante devuelto en efectivo deja la plata a cargo de quien cerró", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    const efectivoAntes = await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId));
    await cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "DEVOLUCION_EFECTIVO" });
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(efectivoAntes + 3_600_000n);
  });

  it("si gastaron de más, se les reintegra la diferencia al cerrar", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 15_000_000n, medio: "TRANSFERENCIA" });
    await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    expect((await resumenCocina(conexion.db, cocina.id)).saldoCentavos).toBe(-1_400_000n);
    await cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "REINTEGRO_TRANSFERENCIA" });
    const r = await resumenCocina(conexion.db, cocina.id);
    expect(r.reintegradoCentavos).toBe(1_400_000n);
    expect(r.saldoCentavos).toBe(0n);
  });

  it("dejar una diferencia sin devolver o sin reintegrar: solo el dueño y con motivo", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    await expect(cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "SOBRANTE_NO_DEVUELTO", motivo: "Se lo quedan" })).rejects.toThrow("Solo el dueño");
    await expect(cerrarCocina(conexion.db, dueno, { cocinaId: cocina.id, forma: "SOBRANTE_NO_DEVUELTO" })).rejects.toThrow("motivo");
    await cerrarCocina(conexion.db, dueno, { cocinaId: cocina.id, forma: "SOBRANTE_NO_DEVUELTO", motivo: "Compraron hielo sin ticket" });
    expect(await saldoDeCuenta(conexion.db, codigoCuentaCocina(cocina.id))).toBe(0n);
  });

  it("una cocina cerrada no acepta más plata, gastos ni anulaciones, y su link deja de andar", async () => {
    const { cocina, token } = await nuevaCocina();
    await cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "SIN_DIFERENCIA" });
    await expect(adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 100n, medio: "TRANSFERENCIA" })).rejects.toThrow("cerró");
    await expect(gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria })).rejects.toThrow("cerró");
    await expect(cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "SIN_DIFERENCIA" })).rejects.toThrow("cerró");
    expect(await cocinaPorToken(conexion.db, token)).toBeNull();
  });

  it("anular un gasto o un adelanto (solo el dueño) devuelve el saldo a como estaba", async () => {
    const { cocina } = await nuevaCocina();
    const adelanto = await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    const gasto = await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    await expect(anularGasto(conexion.db, admin, gasto.id, "Ticket repetido")).rejects.toThrow("Solo el dueño");
    await anularGasto(conexion.db, dueno, gasto.id, "Ticket repetido");
    expect((await resumenCocina(conexion.db, cocina.id)).saldoCentavos).toBe(20_000_000n);
    await anularMovimientoCocina(conexion.db, dueno, adelanto.id, "Se cargó en la cocina equivocada");
    expect((await resumenCocina(conexion.db, cocina.id)).saldoCentavos).toBe(0n);
  });

  it("si cierran la cocina mientras alguien carga un gasto, gana uno y la cuenta queda bien", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    const resultados = await Promise.allSettled([
      gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria }),
      cerrarCocina(conexion.db, admin, { cocinaId: cocina.id, forma: "DEVOLUCION_TRANSFERENCIA" }),
    ]);
    const r = await resumenCocina(conexion.db, cocina.id);
    if (r.cocina.estado === "CERRADA") expect(r.saldoCentavos).toBe(0n);
    expect(resultados.some((x) => x.status === "fulfilled")).toBe(true);
  });
});

describe("gastos: validaciones y protecciones", () => {
  it("rechaza gastos sin productos o con importes inválidos", async () => {
    const { cocina } = await nuevaCocina();
    await expect(gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: [] })).rejects.toThrow("al menos un producto");
    await expect(
      gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: [{ descripcion: "X", categoria: "CARNE", subtotalCentavos: 0n }] }),
    ).rejects.toThrow("no es válido");
  });

  it("la base no deja cambiar ni borrar un gasto ni sus productos, ni agregarle productos después", async () => {
    const { cocina } = await nuevaCocina();
    await adelantar(conexion.db, admin, { cocinaId: cocina.id, montoCentavos: 20_000_000n, medio: "TRANSFERENCIA" });
    const gasto = await gastoDeCocina(conexion.db, admin, { cocinaId: cocina.id, origenCarga: "MANUAL", items: carniceria });
    await expect(conexion.db.update(gastos).set({ totalCentavos: 1n }).where(eq(gastos.id, gasto.id))).rejects.toThrow();
    await expect(conexion.db.delete(gastos).where(eq(gastos.id, gasto.id))).rejects.toThrow();
    await expect(conexion.db.update(gastoItems).set({ subtotalCentavos: 1n }).where(eq(gastoItems.gastoId, gasto.id))).rejects.toThrow();
    await expect(
      conexion.db.insert(gastoItems).values({ gastoId: gasto.id, descripcion: "Extra", categoria: "CARNE", subtotalCentavos: 100n }),
    ).rejects.toThrow();
  });

  it("la base rechaza un gasto cuyos productos no suman el total", async () => {
    await expect(
      conexion.db.transaction(async (tx) => {
        const asiento = await tx.execute<{ id: string }>(sql`
          with a as (insert into asientos_caja (fecha, descripcion, origen) values (now(), 'x', 'GASTO') returning id)
          select id from a`);
        const asientoId = asiento.rows[0]?.id;
        await tx.execute(sql`insert into movimientos_caja (asiento_id, cuenta_id, monto_centavos)
          select ${asientoId}, id, case when codigo = 'CUENTA' then -1000 else 1000 end from cuentas_caja where codigo in ('CUENTA', 'EGRESO:CARNE')`);
        const g = await tx.execute<{ id: string }>(sql`insert into gastos (fecha, descripcion, total_centavos, cuenta_origen_codigo, origen_carga, asiento_id)
          values (now(), 'trucho', 1000, 'CUENTA', 'MANUAL', ${asientoId}) returning id`);
        await tx.execute(sql`insert into gasto_items (gasto_id, descripcion, categoria, subtotal_centavos) values (${g.rows[0]?.id}, 'algo', 'CARNE', 999)`);
      }),
    ).rejects.toThrow();
  });
});
