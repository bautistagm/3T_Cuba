import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearDueno } from "../admins/admins.js";
import type { ActorAdmin } from "../caja/libro.js";
import type { ConexionBase } from "../db/cliente.js";
import { comprasEntradas, notificaciones } from "../db/esquema.js";
import { crearCompra, crearFiesta, detalleFiesta } from "../fiestas/fiestas.js";
import { prepararBaseLimpia } from "../pruebas/base.js";
import { anularPago } from "../sabados/sabados.js";
import { fijarFechaCorte, leerCuenta } from "../verificacion/transferencias.js";
import type { EntradaCuenta } from "../verificacion/cruce.js";
import { enviarPendientes, MAXIMO_INTENTOS, mensajeDeCorreo, reenviarEntradas, type EmailParaEnviar, type Enviador } from "./entradas.js";

let conexion: ConexionBase;
let dueno: ActorAdmin;
let link = "";
let enviados: EmailParaEnviar[] = [];
let falla = false;
const enviador: Enviador = async (email) => {
  if (falla) throw new Error("Gmail no responde");
  enviados.push(email);
};
const URL = "https://3t.ejemplo.com";
let n = 9000;
let cuenta: EntradaCuenta[] = [];
const pagar = async (dni: string, pesos: number) => {
  cuenta = [{ mpPagoId: String(++n), e2eId: null, montoCentavos: BigInt(pesos) * 100n, fecha: new Date(Date.now() - 60_000), cuitPagador: `27${dni}4` }];
  await leerCuenta(conexion.db, async () => cuenta, {});
};
const despachar = (ahora = new Date()) => enviarPendientes(conexion.db, enviador, URL, ahora);

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  await fijarFechaCorte(conexion.db, dueno, "2026-01-01");
  const f = await crearFiesta(conexion.db, dueno, { nombre: "Fiesta <de> prueba", fechaHora: new Date(Date.now() + 7 * 86_400_000), lugar: "Club", tipos: [{ nombre: "Mujer", precioCentavos: 1000000n }] });
  link = (await detalleFiesta(conexion.db, f.id, dueno)).tipos[0]?.tokenVenta ?? "";
});
afterAll(async () => {
  await conexion.cerrar();
});
beforeEach(() => {
  enviados = [];
  falla = false;
});

describe("email con las entradas", () => {
  it("al pagarse la compra se anota el email y se manda con un QR por entrada", async () => {
    const c = await crearCompra(conexion.db, link, { entradas: [{ nombre: "Ana Pérez", dni: "40111222" }, { nombre: "Bea Gómez", dni: "41222333" }], email: "ana@ejemplo.com" });
    expect(await despachar()).toEqual({ enviadas: 0, fallidas: 0 }); // todavía no pagó
    await pagar("40111222", 20000);
    expect(await despachar()).toEqual({ enviadas: 1, fallidas: 0 });
    const [email] = enviados;
    expect(email).toMatchObject({ para: "ana@ejemplo.com", asunto: "Tus entradas para Fiesta <de> prueba" });
    expect(email?.adjuntos).toHaveLength(2);
    expect(email?.adjuntos[0]?.contenido.subarray(1, 4).toString()).toBe("PNG");
    expect(email?.html).toContain("Fiesta &lt;de&gt; prueba"); // sin HTML inyectado
    expect(email?.html).toContain("cid:qr-2@3t");
    expect(email?.html).toContain(`${URL}/mi-entrada/${c.codigoConsulta}`);
    expect(email?.texto).toContain("Bea Gómez (DNI 41.222.333)");
    expect(await despachar()).toEqual({ enviadas: 0, fallidas: 0 }); // no se manda dos veces

    // Armado real del email (sin mandarlo): las imágenes van pegadas con su Content-ID.
    const transporte = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const armado = await transporte.sendMail(mensajeDeCorreo(email as EmailParaEnviar, "plantelcuba@gmail.com"));
    const crudo = (armado.message as Buffer).toString();
    expect(crudo).toContain("Content-ID: <qr-1@3t>");
    expect(crudo).toContain("Content-Type: image/png");
    expect(crudo).toMatch(/^From: .*Plantel_CUBA.* <plantelcuba@gmail\.com>$/m);
  });

  it("si Gmail falla, reintenta más tarde y al final se rinde", async () => {
    await crearCompra(conexion.db, link, { entradas: [{ nombre: "Carla Ruiz", dni: "42333444" }], email: "carla@ejemplo.com" });
    await pagar("42333444", 10000);
    falla = true;
    let ahora = new Date();
    expect(await despachar(ahora)).toEqual({ enviadas: 0, fallidas: 1 });
    expect(await despachar(ahora)).toEqual({ enviadas: 0, fallidas: 0 }); // espera antes de reintentar
    for (let i = 1; i < MAXIMO_INTENTOS; i++) {
      ahora = new Date(ahora.getTime() + 4 * 3600_000);
      await despachar(ahora);
    }
    const [n] = await conexion.db.select().from(notificaciones).where(eq(notificaciones.destinatario, "carla@ejemplo.com"));
    expect(n).toMatchObject({ estado: "FALLIDA", intentos: MAXIMO_INTENTOS, ultimoError: "Gmail no responde" });
  });

  it("el dueño reenvía, incluso a otro email", async () => {
    const [compra] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.email, "carla@ejemplo.com"));
    expect(await reenviarEntradas(conexion.db, compra?.id ?? "", "carla.otra@ejemplo.com")).toBe("ANOTADO");
    await despachar();
    expect(enviados.map((e) => e.para)).toEqual(["carla.otra@ejemplo.com"]);
  });

  it("si la compra se anula antes de mandar, no se manda", async () => {
    await crearCompra(conexion.db, link, { entradas: [{ nombre: "Dora Paz", dni: "43444555" }], email: "dora@ejemplo.com" });
    await pagar("43444555", 10000);
    const [compra] = await conexion.db.select().from(comprasEntradas).where(eq(comprasEntradas.email, "dora@ejemplo.com"));
    await anularPago(conexion.db, dueno, compra?.pagoId ?? "", "Pidió la devolución");
    await despachar();
    expect(enviados).toHaveLength(0);
    expect(await reenviarEntradas(conexion.db, compra?.id ?? "")).toBe("NO_PAGADA");
  });

  it("sin la clave de Gmail cargada, los emails quedan pendientes", async () => {
    expect(await enviarPendientes(conexion.db, null, URL)).toEqual({ enviadas: 0, fallidas: 0 });
  });
});
