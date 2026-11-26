import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { construirApp } from "../app.js";
import { codigoEfectivo } from "../caja/cuentas.js";
import { saldoDeCuenta, type ActorAdmin } from "../caja/libro.js";
import { saldosCaja } from "../caja/operaciones.js";
import type { ConexionBase } from "../db/cliente.js";
import { fiestas, ventasPuerta } from "../db/esquema.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";
import { codigoCuentaPuerta, eliminarVentaPuerta, recibirPlataDePuerta, registrarVentasPuerta } from "./cobrosPuerta.js";
import { antesDeEliminarFiesta, eliminarFiesta } from "./eliminar.js";
import { crearFiesta, detalleFiesta } from "./fiestas.js";
import { listaDePuerta } from "./puerta.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let fiestaId = "";
let puerta = "";
let tipoId = "";
const publico = { tipo: "PUBLICO" as const };
const venta = (por: string, pesos: number, cantidad = 1) => ({ id: randomUUID(), tipoId, cantidad, montoCentavos: BigInt(pesos) * 100n, por, en: new Date() });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
  const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta", fechaHora: new Date(Date.now() + 86_400_000), tipos: [{ nombre: "Hombre", precioCentavos: 1_500_000n }] });
  fiestaId = f.id;
  const det = await detalleFiesta(conexion.db, f.id, dueno);
  puerta = det.fiesta.tokenPuerta ?? "";
  tipoId = det.tipos[0]?.id ?? "";
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("cobrar en la puerta", () => {
  it("queda a cargo de quien cobró; un reintento no se cuenta dos veces", async () => {
    const v = venta("Tomás", 20000, 2);
    await registrarVentasPuerta(conexion.db, publico, puerta, { ventas: [v] });
    await registrarVentasPuerta(conexion.db, publico, puerta, { ventas: [v] });
    await registrarVentasPuerta(conexion.db, publico, puerta, { ventas: [venta("Tomás", 10000), venta("Lucas", 12000)] });
    expect(await saldoDeCuenta(conexion.db, codigoCuentaPuerta(fiestaId))).toBe(4_200_000n);
    const d = await detalleFiesta(conexion.db, fiestaId, dueno);
    expect(d.puerta.aRendir.map((p) => [p.nombre, p.centavos]).sort()).toEqual([["Lucas", 1_200_000n], ["Tomás", 3_000_000n]]);
    expect((await listaDePuerta(conexion.db, puerta)).cobrosPuerta).toHaveLength(3);
    expect((await saldosCaja(conexion.db)).puertas).toEqual([{ fiestaId, fiesta: "Fiesta", centavos: 4_200_000n }]);
  });

  it("no acepta tipos de otra fiesta ni links falsos", async () => {
    await expect(registrarVentasPuerta(conexion.db, publico, puerta, { ventas: [{ ...venta("Xavi", 1), tipoId: randomUUID() }] })).rejects.toMatchObject({ codigo: "TIPO_INVALIDO" });
    await expect(registrarVentasPuerta(conexion.db, publico, "link-falso-12345", { ventas: [venta("Xavi", 1)] })).rejects.toMatchObject({ codigo: "LINK_INVALIDO" });
  });

  it("no se puede eliminar la fiesta con plata sin entregar; al recibirla pasa al efectivo del admin", async () => {
    expect((await antesDeEliminarFiesta(conexion.db, dueno, fiestaId)).puertaSinEntregar.sort()).toEqual(["Lucas", "Tomás"]);
    await expect(eliminarFiesta(conexion.db, dueno, fiestaId, { plata: { destino: "DEVUELTA" } })).rejects.toMatchObject({ codigo: "PUERTA_SIN_ENTREGAR" });
    await recibirPlataDePuerta(conexion.db, admin, fiestaId, "Tomás");
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(3_000_000n);
    expect(await saldoDeCuenta(conexion.db, codigoCuentaPuerta(fiestaId))).toBe(1_200_000n);
    await expect(recibirPlataDePuerta(conexion.db, admin, fiestaId, "Tomás")).rejects.toMatchObject({ codigo: "NADA_PARA_RECIBIR" });
  });

  it("el dueño elimina un cobro mal cargado mientras no se entregó", async () => {
    const [lucas] = await conexion.db.select().from(ventasPuerta).where(eq(ventasPuerta.cobradoPor, "Lucas"));
    await expect(eliminarVentaPuerta(conexion.db, admin, lucas?.id ?? "")).rejects.toMatchObject({ codigo: "SOLO_DUENO" });
    await eliminarVentaPuerta(conexion.db, dueno, lucas?.id ?? "");
    expect(await saldoDeCuenta(conexion.db, codigoCuentaPuerta(fiestaId))).toBe(0n);
    const [tomas] = await conexion.db.select().from(ventasPuerta).where(eq(ventasPuerta.cobradoPor, "Tomás"));
    await expect(eliminarVentaPuerta(conexion.db, dueno, tomas?.id ?? "")).rejects.toMatchObject({ codigo: "YA_ENTREGADO" });
  });

  it("al eliminar la fiesta, lo entregado se devuelve desde el efectivo del admin", async () => {
    await eliminarFiesta(conexion.db, dueno, fiestaId, { plata: { destino: "DEVUELTA" } });
    expect(await saldoDeCuenta(conexion.db, codigoEfectivo(admin.adminId))).toBe(0n);
    expect(await conexion.db.select().from(fiestas).where(eq(fiestas.id, fiestaId))).toHaveLength(0);
  });
});

describe("API de cobros en la puerta", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await construirApp({ db: conexion.db, config: configDePrueba });
  });
  afterAll(async () => {
    await app.close();
  });
  it("anda sin usuario, con el link", async () => {
    const f = await crearFiesta(conexion.db, dueno, { nombre: "Otra", fechaHora: new Date(Date.now() + 86_400_000), tipos: [{ nombre: "Mujer", precioCentavos: 1_000_000n }] });
    const det = await detalleFiesta(conexion.db, f.id, dueno);
    const r = await app.inject({
      method: "POST",
      url: `/api/publico/puerta/${det.fiesta.tokenPuerta}/ventas`,
      payload: { ventas: [{ id: randomUUID(), tipoId: det.tipos[0]?.id, cantidad: 1, montoCentavos: "1000000", por: "Tomás", en: new Date().toISOString() }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().listos).toHaveLength(1);
  });
});
