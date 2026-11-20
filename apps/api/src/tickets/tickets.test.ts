import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ActorAdmin } from "../caja/libro.js";
import { crearCocina, resumenCocina } from "../cocina/cocina.js";
import type { ConexionBase } from "../db/cliente.js";
import type { LecturaTicket, LectorTickets } from "../ia/lectorTickets.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";
import { obtenerOCrearSabado } from "../sabados/sabados.js";
import { descartarTicket, evaluarLectura, resolverTicket, subirTicketDeCocina, tipoDeImagen } from "./tickets.js";

const lecturaBuena: LecturaTicket = {
  es_ticket: true,
  legible: true,
  proveedor: "Carnicería El Toro",
  fecha: null,
  total_centavos: 16_400_000,
  items: [
    { descripcion: "Vacío", cantidad: "15 kg", categoria: "CARNE", importe_centavos: 12_000_000 },
    { descripcion: "Chorizo", cantidad: "8 kg", categoria: "CARNE", importe_centavos: 4_400_000 },
  ],
  observaciones: null,
};

/** Una "foto" JPEG distinta cada vez (solo importa la firma del archivo). */
const fotoJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);

let respuestaIa: LecturaTicket | Error = lecturaBuena;
const lectorFalso: LectorTickets = async () => {
  if (respuestaIa instanceof Error) throw respuestaIa;
  return respuestaIa;
};

let conexion: ConexionBase;
let app: FastifyInstance;
let dueno: ActorAdmin;
let admin: ActorAdmin;
let semana = 0;

async function nuevaCocina() {
  const fecha = new Date(Date.UTC(2027, 1, 6 + 7 * semana++)).toISOString().slice(0, 10);
  const sabado = await obtenerOCrearSabado(conexion.db, fecha);
  return crearCocina(conexion.db, admin, { sabadoId: sabado.id, camada: "2015", responsableNombre: "Agustín" });
}

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba, lectorTickets: lectorFalso });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  dueno = { tipo: "ADMIN", adminId: d.id, rol: "DUENO" };
  const a = await crearAdmin(conexion.db, dueno, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  admin = { tipo: "ADMIN", adminId: a.id, rol: "ADMIN" };
});

afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("evaluar lo que leyó la IA", () => {
  it("una lectura que cierra se acepta", () => {
    expect(evaluarLectura(lecturaBuena).ok).toBe(true);
  });

  it.each<[string, Partial<LecturaTicket>, string]>([
    ["no es un ticket", { es_ticket: false }, "no parece un ticket"],
    ["no se lee", { legible: false, observaciones: "Foto borrosa" }, "Foto borrosa"],
    ["sin productos", { items: [] }, "no encontró productos"],
    ["sin total", { total_centavos: null }, "no encontró el total"],
    ["los productos no suman el total", { total_centavos: 16_500_000 }, "suman $164.000"],
    ["un importe en cero", { items: [{ descripcion: "Nada", cantidad: null, categoria: "OTROS", importe_centavos: 0 }], total_centavos: 0 }, "no es válido"],
  ])("manda a revisar si %s", (_caso, cambio, mensaje) => {
    const r = evaluarLectura({ ...lecturaBuena, ...cambio });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain(mensaje);
  });
});

describe("tipo de imagen", () => {
  it("reconoce por el contenido, no por el nombre", () => {
    expect(tipoDeImagen(fotoJpeg())).toBe("image/jpeg");
    expect(tipoDeImagen(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
});

describe("subir tickets", () => {
  it("si la IA lo lee bien, el gasto se registra solo, producto por producto", async () => {
    respuestaIa = lecturaBuena;
    const { cocina } = await nuevaCocina();
    const r = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: fotoJpeg() });
    expect(r.estado).toBe("REGISTRADO");
    const resumen = await resumenCocina(conexion.db, cocina.id);
    expect(resumen.gastadoCentavos).toBe(16_400_000n);
    expect(resumen.gastos[0]?.origenCarga).toBe("IA");
    expect(resumen.gastos[0]?.items).toHaveLength(2);
  });

  it("si los números no cierran, queda para revisar y no se registra ningún gasto", async () => {
    respuestaIa = { ...lecturaBuena, total_centavos: 17_000_000 };
    const { cocina } = await nuevaCocina();
    const r = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: fotoJpeg() });
    expect(r.estado).toBe("REVISAR");
    expect((await resumenCocina(conexion.db, cocina.id)).gastadoCentavos).toBe(0n);
  });

  it("si la IA falla o está saturada, queda para revisar (no se pierde la foto)", async () => {
    respuestaIa = new Error("Servicio saturado");
    const { cocina } = await nuevaCocina();
    const r = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: fotoJpeg() });
    expect(r.estado).toBe("REVISAR");
    expect(r.motivoRevision).toContain("saturado");
  });

  it("la misma foto dos veces: la segunda va a revisar (evita contar un ticket doble)", async () => {
    respuestaIa = lecturaBuena;
    const { cocina } = await nuevaCocina();
    const foto = fotoJpeg();
    expect((await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: foto })).estado).toBe("REGISTRADO");
    const segunda = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: foto });
    expect(segunda.estado).toBe("REVISAR");
    expect(segunda.motivoRevision).toContain("ya se había subido");
    expect((await resumenCocina(conexion.db, cocina.id)).gastadoCentavos).toBe(16_400_000n);
  });

  it("rechaza archivos que no son fotos", async () => {
    const { cocina } = await nuevaCocina();
    await expect(
      subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: Buffer.from("no es una foto") }),
    ).rejects.toThrow("no es una foto");
  });

  it("un admin resuelve un ticket a revisar corrigiendo los números, o lo descarta", async () => {
    respuestaIa = { ...lecturaBuena, legible: false };
    const { cocina } = await nuevaCocina();
    const a = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: fotoJpeg() });
    const b = await subirTicketDeCocina(conexion.db, lectorFalso, admin, { cocinaId: cocina.id, contenido: fotoJpeg() });
    await resolverTicket(conexion.db, admin, a.ticketId, {
      proveedor: "Carnicería",
      items: [{ descripcion: "Vacío", categoria: "CARNE", subtotalCentavos: 12_000_000n }],
    });
    await descartarTicket(conexion.db, admin, b.ticketId, "Foto repetida de otro ángulo");
    await expect(descartarTicket(conexion.db, admin, a.ticketId, "Otra vez")).rejects.toThrow("ya se resolvió");
    expect((await resumenCocina(conexion.db, cocina.id)).gastadoCentavos).toBe(12_000_000n);
  });
});

describe("por la API y desde el link del responsable", () => {
  it("el responsable sube una foto desde su link y ve el gasto; con la cocina cerrada, el link no anda", async () => {
    respuestaIa = lecturaBuena;
    const { cocina, token } = await nuevaCocina();
    const subida = await app.inject({
      method: "POST",
      url: `/api/publico/cocina/${token}/tickets`,
      payload: { imagenBase64: fotoJpeg().toString("base64") },
    });
    expect(subida.statusCode).toBe(201);
    expect(subida.json().estado).toBe("REGISTRADO");
    const pagina = (await app.inject({ method: "GET", url: `/api/publico/cocina/${token}` })).json();
    expect(pagina.gastadoCentavos).toBe("16400000");

    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "j@ejemplo.com", contrasena: "clave-de-juan-12" }, remoteAddress: "10.3.0.1" });
    const cookie = `${COOKIE_SESION}=${login.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
    const lista = (await app.inject({ method: "GET", url: `/api/cocinas/${cocina.id}/tickets`, headers: { cookie } })).json();
    expect(lista.tickets).toHaveLength(1);
    const foto = await app.inject({ method: "GET", url: `/api/tickets/${lista.tickets[0].id}/foto`, headers: { cookie } });
    expect(foto.headers["content-type"]).toBe("image/jpeg");
    expect((await app.inject({ method: "GET", url: `/api/tickets/${lista.tickets[0].id}/foto` })).statusCode).toBe(401);

    await app.inject({ method: "POST", url: `/api/cocinas/${cocina.id}/cerrar`, headers: { cookie }, payload: { forma: "REINTEGRO_TRANSFERENCIA" } });
    const tarde = await app.inject({ method: "POST", url: `/api/publico/cocina/${token}/tickets`, payload: { imagenBase64: fotoJpeg().toString("base64") } });
    expect(tarde.statusCode).toBe(404);
  });

  it("rechaza fotos mal enviadas", async () => {
    const { token } = await nuevaCocina();
    const mala = await app.inject({ method: "POST", url: `/api/publico/cocina/${token}/tickets`, payload: { imagenBase64: "esto no es base64 !!!" } });
    expect(mala.statusCode).toBe(400);
  });
});
