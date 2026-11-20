import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import type { ConexionBase } from "../db/cliente.js";
import { asientosCaja, auditoria, movimientosCaja } from "../db/esquema.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { codigoEfectivo } from "./cuentas.js";
import { ErrorCaja, anularAsiento, registrarAsiento, saldoDeCuenta, saldoDisponible, type ActorAdmin } from "./libro.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let efectivoAdmin: string;

const CUOTA = 3_000_000n; // $30.000

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  efectivoAdmin = codigoEfectivo(a.id);
});

afterAll(async () => {
  await conexion.cerrar();
});

/** Un jugador le paga la cuota en efectivo a Juan. */
function cobrarCuotaEnEfectivo(monto = CUOTA) {
  return conexion.db.transaction((tx) =>
    registrarAsiento(tx, admin, {
      fecha: new Date(),
      descripcion: "Cuota en efectivo",
      origen: "PAGO",
      lineas: [
        { cuentaCodigo: efectivoAdmin, montoCentavos: monto },
        { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -monto },
      ],
    }),
  );
}

describe("registrar asientos", () => {
  it("un cobro en efectivo sube el efectivo del admin y queda en la auditoría", async () => {
    const antes = await saldoDeCuenta(conexion.db, efectivoAdmin);
    const asientoId = await cobrarCuotaEnEfectivo();
    expect(await saldoDeCuenta(conexion.db, efectivoAdmin)).toBe(antes + CUOTA);
    const [registro] = await conexion.db.select().from(auditoria).where(eq(auditoria.entidadId, asientoId));
    expect(registro?.accion).toBe("CAJA_ASIENTO_REGISTRADO");
  });

  it("150 cuotas suman exacto, sin un centavo de diferencia", async () => {
    const antes = await saldoDisponible(conexion.db);
    await conexion.db.transaction(async (tx) => {
      for (let i = 0; i < 150; i++) {
        await registrarAsiento(tx, admin, {
          fecha: new Date(),
          descripcion: `Cuota ${i}`,
          origen: "PAGO",
          lineas: [
            { cuentaCodigo: "CUENTA", montoCentavos: 3_000_001n },
            { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -3_000_001n },
          ],
        });
      }
    });
    expect(await saldoDisponible(conexion.db)).toBe(antes + 450_000_150n);
  });

  it("una rendición pasa plata del efectivo del admin a la cuenta sin cambiar el total disponible", async () => {
    await cobrarCuotaEnEfectivo();
    const totalAntes = await saldoDisponible(conexion.db);
    const efectivoAntes = await saldoDeCuenta(conexion.db, efectivoAdmin);
    await conexion.db.transaction((tx) =>
      registrarAsiento(tx, admin, {
        fecha: new Date(),
        descripcion: "Juan deposita el efectivo",
        origen: "RENDICION",
        lineas: [
          { cuentaCodigo: efectivoAdmin, montoCentavos: -CUOTA },
          { cuentaCodigo: "CUENTA", montoCentavos: CUOTA },
        ],
      }),
    );
    expect(await saldoDeCuenta(conexion.db, efectivoAdmin)).toBe(efectivoAntes - CUOTA);
    expect(await saldoDisponible(conexion.db)).toBe(totalAntes);
  });

  it.each([
    ["desbalanceado", [{ cuentaCodigo: "CUENTA", montoCentavos: 100n }, { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -99n }]],
    ["con un solo movimiento", [{ cuentaCodigo: "CUENTA", montoCentavos: 100n }]],
    ["con un movimiento de $0", [{ cuentaCodigo: "CUENTA", montoCentavos: 0n }, { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: 0n }]],
    ["con una cuenta que no existe", [{ cuentaCodigo: "CUENTA", montoCentavos: 100n }, { cuentaCodigo: "INVENTADA", montoCentavos: -100n }]],
  ])("rechaza un asiento %s", async (_caso, lineas) => {
    await expect(
      conexion.db.transaction((tx) =>
        registrarAsiento(tx, admin, { fecha: new Date(), descripcion: "x", origen: "AJUSTE", lineas }),
      ),
    ).rejects.toBeInstanceOf(ErrorCaja);
  });

  it("rechaza montos que no son enteros (por ejemplo, un número con decimales)", async () => {
    const lineas = [
      { cuentaCodigo: "CUENTA", montoCentavos: 0.5 as unknown as bigint },
      { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -0.5 as unknown as bigint },
    ];
    await expect(
      conexion.db.transaction((tx) => registrarAsiento(tx, admin, { fecha: new Date(), descripcion: "x", origen: "AJUSTE", lineas })),
    ).rejects.toBeInstanceOf(ErrorCaja);
  });

  it("si algo falla en la misma operación, no queda nada guardado (ni el asiento ni la auditoría)", async () => {
    const asientosAntes = await conexion.db.$count(asientosCaja);
    const auditoriaAntes = await conexion.db.$count(auditoria);
    await expect(
      conexion.db.transaction(async (tx) => {
        await registrarAsiento(tx, admin, {
          fecha: new Date(),
          descripcion: "Se va a deshacer",
          origen: "PAGO",
          lineas: [
            { cuentaCodigo: "CUENTA", montoCentavos: CUOTA },
            { cuentaCodigo: "INGRESO:CUOTAS", montoCentavos: -CUOTA },
          ],
        });
        throw new Error("falla después de registrar");
      }),
    ).rejects.toThrow("falla después de registrar");
    expect(await conexion.db.$count(asientosCaja)).toBe(asientosAntes);
    expect(await conexion.db.$count(auditoria)).toBe(auditoriaAntes);
  });
});

describe("anular asientos", () => {
  it("solo el dueño puede anular", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    await expect(
      conexion.db.transaction((tx) => anularAsiento(tx, admin, { asientoId, motivo: "Me equivoqué de jugador" })),
    ).rejects.toThrow("Solo el dueño");
  });

  it("hay que escribir un motivo", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    await expect(conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: " " }))).rejects.toThrow("motivo");
  });

  it("anular deja el original intacto, crea el espejo y devuelve el saldo a como estaba", async () => {
    const saldoAntes = await saldoDeCuenta(conexion.db, efectivoAdmin);
    const asientoId = await cobrarCuotaEnEfectivo();
    const anulacionId = await conexion.db.transaction((tx) =>
      anularAsiento(tx, dueno, { asientoId, motivo: "Cargado dos veces" }),
    );
    expect(await saldoDeCuenta(conexion.db, efectivoAdmin)).toBe(saldoAntes);

    const original = await conexion.db.select().from(movimientosCaja).where(eq(movimientosCaja.asientoId, asientoId));
    const espejo = await conexion.db.select().from(movimientosCaja).where(eq(movimientosCaja.asientoId, anulacionId));
    expect(original).toHaveLength(2);
    expect(espejo.map((m) => m.montoCentavos).sort()).toEqual(original.map((m) => -m.montoCentavos).sort());
  });

  it("no se puede anular dos veces el mismo asiento", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    await conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: "Primera anulación" }));
    await expect(
      conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: "Segunda anulación" })),
    ).rejects.toThrow("ya fue anulado");
  });

  it("no se puede anular una anulación", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    const anulacionId = await conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: "Error de carga" }));
    await expect(
      conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId: anulacionId, motivo: "Deshacer" })),
    ).rejects.toThrow("anulación");
  });

  it("si dos personas anulan el mismo asiento al mismo tiempo, solo una lo logra", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    const resultados = await Promise.allSettled([
      conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: "Desde el celular" })),
      conexion.db.transaction((tx) => anularAsiento(tx, dueno, { asientoId, motivo: "Desde la compu" })),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("protecciones dentro de la base de datos (aunque alguien saltee el código)", () => {
  /** Verifica que la base rechazó la operación con el mensaje esperado (y no por otro error cualquiera). */
  async function rechazaConMensaje(operacion: Promise<unknown>, texto: string): Promise<void> {
    const error = await operacion.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, "la base tenía que rechazar la operación").not.toBeNull();
    const mensajes: string[] = [];
    for (let actual: unknown = error; actual instanceof Error; actual = actual.cause) mensajes.push(actual.message);
    expect(mensajes.join(" | ")).toContain(texto);
  }
  async function idDeCuenta(codigo: string): Promise<string> {
    const r = await conexion.db.execute<{ id: string }>(sql`select id from cuentas_caja where codigo = ${codigo}`);
    const fila = r.rows[0];
    if (!fila) throw new Error(`No existe la cuenta ${codigo}`);
    return fila.id;
  }

  it.each(["movimientos_caja", "asientos_caja", "auditoria"])("no se pueden modificar ni borrar filas de %s", async (tabla) => {
    await cobrarCuotaEnEfectivo();
    const t = sql.identifier(tabla);
    await rechazaConMensaje(conexion.db.execute(sql`delete from ${t}`), "no admite DELETE");
    await rechazaConMensaje(conexion.db.execute(sql`truncate ${t} cascade`), "no admite TRUNCATE");
    const columna = tabla === "movimientos_caja" ? sql`monto_centavos = monto_centavos * 2` : sql`creado_en = now()`;
    await rechazaConMensaje(conexion.db.execute(sql`update ${t} set ${columna}`), "no admite UPDATE");
  });

  it("rechaza un asiento desbalanceado cargado a mano", async () => {
    const cuenta = await idDeCuenta("CUENTA");
    const cuotas = await idDeCuenta("INGRESO:CUOTAS");
    await rechazaConMensaje(
      conexion.db.transaction(async (tx) => {
        const r = await tx.execute<{ id: string }>(
          sql`insert into asientos_caja (fecha, descripcion, origen) values (now(), 'trucho', 'AJUSTE') returning id`,
        );
        const id = r.rows[0]?.id;
        await tx.execute(sql`insert into movimientos_caja (asiento_id, cuenta_id, monto_centavos) values
          (${id}, ${cuenta}, 1000000), (${id}, ${cuotas}, -1)`);
      }),
      "no está balanceado",
    );
  });

  it("rechaza un asiento sin movimientos o con uno solo", async () => {
    const cuenta = await idDeCuenta("CUENTA");
    await rechazaConMensaje(
      conexion.db.execute(sql`insert into asientos_caja (fecha, descripcion, origen) values (now(), 'vacío', 'AJUSTE')`),
      "al menos dos movimientos",
    );
    await rechazaConMensaje(
      conexion.db.transaction(async (tx) => {
        const r = await tx.execute<{ id: string }>(
          sql`insert into asientos_caja (fecha, descripcion, origen) values (now(), 'solo', 'AJUSTE') returning id`,
        );
        // Un único movimiento de 0 no se puede (check), así que probamos con uno de $1.
        await tx.execute(sql`insert into movimientos_caja (asiento_id, cuenta_id, monto_centavos) values (${r.rows[0]?.id}, ${cuenta}, 100)`);
      }),
      "al menos dos movimientos",
    );
  });

  it("no deja agregar movimientos a un asiento viejo, aunque estén balanceados", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    const cuenta = await idDeCuenta("CUENTA");
    const cuotas = await idDeCuenta("INGRESO:CUOTAS");
    await rechazaConMensaje(
      conexion.db.execute(sql`insert into movimientos_caja (asiento_id, cuenta_id, monto_centavos) values
        (${asientoId}, ${cuenta}, 500), (${asientoId}, ${cuotas}, -500)`),
      "ya estaba cerrado",
    );
  });

  it("rechaza una anulación trucha que no es el espejo del original", async () => {
    const asientoId = await cobrarCuotaEnEfectivo();
    const cuenta = await idDeCuenta("CUENTA");
    const cuotas = await idDeCuenta("INGRESO:CUOTAS");
    await rechazaConMensaje(
      conexion.db.transaction(async (tx) => {
        const r = await tx.execute<{ id: string }>(
          sql`insert into asientos_caja (fecha, descripcion, origen, anula_asiento_id)
              values (now(), 'anulación trucha', 'ANULACION', ${asientoId}) returning id`,
        );
        const id = r.rows[0]?.id;
        // Balanceada, pero con otras cuentas y otro monto: no es el espejo.
        await tx.execute(sql`insert into movimientos_caja (asiento_id, cuenta_id, monto_centavos) values
          (${id}, ${cuenta}, 1), (${id}, ${cuotas}, -1)`);
      }),
      "no es el espejo exacto",
    );
  });
});
