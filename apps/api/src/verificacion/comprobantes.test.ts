import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { comprobantes, entradasMercadoPago } from "../db/esquema.js";
import type { LecturaComprobante } from "../ia/lectorComprobantes.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import type { EntradaCuenta } from "./cruce.js";
import {
  comprobantesParaRevisar,
  confirmarAMano,
  probarComprobante,
  rechazarComprobante,
  registrarComprobante,
  verificarDeNuevo,
  type DependenciasVerificacion,
} from "./comprobantes.js";

let conexion: ConexionBase;
let actor: ActorAdmin;
const publico = { tipo: "PUBLICO" as const };
/** Una "foto" JPG distinta cada vez. */
const foto = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);

const ahora = new Date("2026-11-24T12:00:00-03:00");
const entrada = (id: string, cambios: Partial<EntradaCuenta> = {}): EntradaCuenta => ({
  mpPagoId: id,
  e2eId: null,
  montoCentavos: 1500000n,
  fecha: new Date("2026-11-24T09:44:00-03:00"),
  cuitPagador: "27300000001",
  ...cambios,
});
const lectura = (cambios: Partial<LecturaComprobante> = {}): LecturaComprobante => ({
  es_comprobante: true,
  legible: true,
  fecha_hora: "2026-11-24T09:44",
  monto_centavos: 1500000,
  nombre_pagador: "Ana Prueba",
  cuit_pagador: "27-30000000-1",
  banco_origen: "Mercado Pago",
  nombre_destinatario: "Bautista",
  cuit_destinatario: "20-30000000-2",
  numero_operacion: null,
  observaciones: null,
  ...cambios,
});

let cuenta: EntradaCuenta[] = [];
let leida: LecturaComprobante = lectura();
const deps: DependenciasVerificacion = {
  lector: async () => leida,
  buscarEntradas: async (desde, hasta) => cuenta.filter((e) => e.fecha >= desde && e.fecha <= hasta),
  ahora: () => ahora,
};
const sinCuenta: DependenciasVerificacion = { ...deps, buscarEntradas: null };

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  actor = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
});
afterAll(async () => {
  await conexion.cerrar();
});
beforeEach(() => {
  cuenta = [];
  leida = lectura();
});

describe("comprobantes", () => {
  it("se confirma solo por número de operación y la entrada queda marcada como usada", async () => {
    leida = lectura({ numero_operacion: "100100" });
    cuenta = [entrada("100100")];
    const llamadas: string[] = [];
    const c = await registrarComprobante(
      conexion.db,
      deps,
      publico,
      { contenido: foto(), destino: "CUOTA", montoEsperadoCentavos: 1500000n, subidoPor: "Ana Prueba" },
      async (tx, comp, e) => {
        llamadas.push(`${comp.id}:${e.mpPagoId}`);
        const [usada] = await tx.select().from(entradasMercadoPago).where(eq(entradasMercadoPago.mpPagoId, e.mpPagoId));
        expect(usada).toBeDefined(); // corre dentro de la misma transacción
      },
    );
    expect(c).toMatchObject({ estado: "VERIFICADO_AUTO", mpPagoId: "100100", confirmadoPor: "NUMERO_OPERACION" });
    expect(llamadas).toEqual([`${c.id}:100100`]);
  });

  it("la misma transferencia no confirma dos comprobantes", async () => {
    cuenta = [entrada("200200")];
    leida = lectura({ numero_operacion: "200200" });
    const primero = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" });
    const segundo = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" });
    expect(primero.estado).toBe("VERIFICADO_AUTO");
    expect(segundo).toMatchObject({ estado: "REVISAR", codigoRevision: "YA_USADO" });
  });

  it("la misma foto subida dos veces va a revisar", async () => {
    const misma = foto();
    await registrarComprobante(conexion.db, sinCuenta, publico, { contenido: misma, destino: "CUOTA" });
    const otra = await registrarComprobante(conexion.db, sinCuenta, publico, { contenido: misma, destino: "CUOTA" });
    expect(otra).toMatchObject({ estado: "REVISAR", codigoRevision: "REPETIDA" });
  });

  it("si todavía no figura, después se puede volver a verificar y se confirma por CUIT", async () => {
    const c = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" });
    expect(c).toMatchObject({ estado: "REVISAR", codigoRevision: "NO_FIGURA" });
    cuenta = [entrada("300300")];
    const despues = await verificarDeNuevo(conexion.db, deps, actor, c.id);
    expect(despues).toMatchObject({ estado: "VERIFICADO_AUTO", mpPagoId: "300300", confirmadoPor: "CUIT" });
    await expect(verificarDeNuevo(conexion.db, deps, actor, c.id)).rejects.toMatchObject({ codigo: "YA_RESUELTO" });
  });

  it("dos candidatos: se confirma a mano eligiendo uno; el otro sigue libre", async () => {
    cuenta = [entrada("400400"), entrada("400401", { fecha: new Date("2026-11-24T10:00:00-03:00") })];
    const c = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA", montoEsperadoCentavos: 1500000n });
    expect(c).toMatchObject({ estado: "REVISAR", codigoRevision: "VARIOS_CANDIDATOS" });
    const lista = await comprobantesParaRevisar(conexion.db);
    const fila = lista.find((x) => x.id === c.id);
    expect(fila?.candidatos.map((x) => x.mpPagoId).sort()).toEqual(["400400", "400401"]);
    expect(JSON.stringify(fila?.candidatos)).not.toContain("27300000001"); // no guarda CUIT de otros

    const confirmado = await confirmarAMano(conexion.db, deps, actor, c.id, "400401");
    expect(confirmado).toMatchObject({ estado: "CONFIRMADO", mpPagoId: "400401", confirmadoPor: "ADMIN" });
  });

  it("a mano tampoco deja usar una transferencia ya usada, ni una de otro monto", async () => {
    cuenta = [entrada("500500"), entrada("500501", { montoCentavos: 999n, cuitPagador: null })];
    leida = lectura({ numero_operacion: "500500" });
    await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" });
    leida = lectura({ cuit_pagador: null, numero_operacion: null });
    const c = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA", montoEsperadoCentavos: 1500000n });
    expect(c.estado).toBe("REVISAR");
    await expect(confirmarAMano(conexion.db, deps, actor, c.id, "500500")).rejects.toMatchObject({ codigo: "YA_USADO" });
    await expect(confirmarAMano(conexion.db, deps, actor, c.id, "500501")).rejects.toMatchObject({ codigo: "MONTO_DISTINTO" });
    await expect(confirmarAMano(conexion.db, deps, actor, c.id, "999999")).rejects.toMatchObject({ codigo: "NO_FIGURA" });
  });

  it("si el cobro falla al confirmar, no queda nada a medias", async () => {
    cuenta = [entrada("600600")];
    leida = lectura({ numero_operacion: "600600" });
    await expect(
      registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" }, async () => {
        throw new Error("falló el cobro");
      }),
    ).rejects.toThrow("falló el cobro");
    const usadas = await conexion.db.select().from(entradasMercadoPago).where(eq(entradasMercadoPago.mpPagoId, "600600"));
    expect(usadas).toHaveLength(0);
  });

  it("rechazar pide motivo y un comprobante resuelto queda fijo", async () => {
    const c = await registrarComprobante(conexion.db, sinCuenta, publico, { contenido: foto(), destino: "ENTRADA_FIESTA" });
    expect(c).toMatchObject({ estado: "REVISAR", codigoRevision: "SIN_CUENTA" });
    await expect(rechazarComprobante(conexion.db, actor, c.id, "  ")).rejects.toMatchObject({ codigo: "FALTA_MOTIVO" });
    const r = await rechazarComprobante(conexion.db, actor, c.id, "Era de otra persona");
    expect(r.estado).toBe("RECHAZADO");
    await expect(conexion.db.update(comprobantes).set({ estado: "REVISAR" }).where(eq(comprobantes.id, c.id))).rejects.toThrow();
    await expect(conexion.db.delete(comprobantes).where(eq(comprobantes.id, c.id))).rejects.toThrow();
  });

  it("la base no deja borrar ni cambiar entradas usadas, ni guardar una entrada suelta", async () => {
    await expect(conexion.db.delete(entradasMercadoPago).where(eq(entradasMercadoPago.mpPagoId, "100100"))).rejects.toThrow();
    await expect(conexion.db.update(entradasMercadoPago).set({ montoCentavos: 1n }).where(eq(entradasMercadoPago.mpPagoId, "100100"))).rejects.toThrow();
    await expect(
      conexion.db.insert(entradasMercadoPago).values({ mpPagoId: "suelta", montoCentavos: 100n, fecha: new Date() }),
    ).rejects.toThrow();
    await expect(conexion.db.execute(sql`UPDATE comprobantes SET lectura_ia = '{}' WHERE estado = 'REVISAR'`)).rejects.toThrow();
  });

  it("una foto que no es comprobante va a revisar sin consultar la cuenta", async () => {
    leida = lectura({ es_comprobante: false });
    const c = await registrarComprobante(conexion.db, deps, publico, { contenido: foto(), destino: "CUOTA" });
    expect(c).toMatchObject({ estado: "REVISAR", codigoRevision: "NO_ES_COMPROBANTE" });
  });

  it("la prueba del dueño no guarda nada", async () => {
    cuenta = [entrada("700700")];
    leida = lectura({ numero_operacion: "700700" });
    const antes = (await conexion.db.select().from(comprobantes)).length;
    const r = await probarComprobante(conexion.db, deps, foto());
    expect(r).toMatchObject({ resultado: "CONFIRMAR", por: "NUMERO_OPERACION", mpPagoId: "700700" });
    expect((await conexion.db.select().from(comprobantes)).length).toBe(antes);
    expect(await conexion.db.select().from(entradasMercadoPago).where(eq(entradasMercadoPago.mpPagoId, "700700"))).toHaveLength(0);
  });
});
