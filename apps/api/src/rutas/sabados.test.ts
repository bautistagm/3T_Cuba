import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";

let conexion: ConexionBase;
let app: FastifyInstance;
let cookieDueno = "";
let cookieAdmin = "";
let ip = 1;

async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.2.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}

const pedir = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload: payload as object }) });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
  cookieAdmin = await entrar("j@ejemplo.com", "clave-de-juan-12");
});

afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("API de sábados", () => {
  it("sin sesión no se ve nada", async () => {
    expect((await app.inject({ method: "GET", url: "/api/sabados/actual" })).statusCode).toBe(401);
  });

  it("el sábado actual existe siempre y los montos llegan como texto de centavos", async () => {
    const r = await pedir(cookieAdmin, "GET", "/api/sabados/actual");
    expect(r.statusCode).toBe(200);
    const datos = r.json();
    expect(datos.sabado.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(datos.cobradoCentavos).toBe("0");
    expect(datos.precioInvitadoCentavos).toBeNull();
  });

  it("solo el dueño fija el precio; después se cobra con un toque", async () => {
    expect((await pedir(cookieAdmin, "PUT", "/api/parametros/precio-invitado", { montoCentavos: "1500000" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "PUT", "/api/parametros/precio-invitado", { montoCentavos: "1500000" })).statusCode).toBe(200);
    const { sabado } = (await pedir(cookieAdmin, "GET", "/api/sabados/actual")).json();
    const cobro = await pedir(cookieAdmin, "POST", `/api/sabados/${sabado.id}/invitados`, { medio: "EFECTIVO", camada: "2015" });
    expect(cobro.statusCode).toBe(201);
    expect(cobro.json().pago.montoCentavos).toBe("1500000");
    const detalle = (await pedir(cookieAdmin, "GET", `/api/sabados/${sabado.id}`)).json();
    expect(detalle.invitados).toBe(1);
    expect(detalle.cobradoCentavos).toBe("1500000");
    expect(Object.values(detalle.nombresAdmins)).toContain("Juan");
  });

  it("rechaza montos con decimales o negativos", async () => {
    for (const monto of ["15000.5", "-100", "0", "abc", 1500000]) {
      expect((await pedir(cookieDueno, "PUT", "/api/parametros/precio-invitado", { montoCentavos: monto })).statusCode).toBe(400);
    }
  });

  it("solo el dueño anula un cobro, y con motivo", async () => {
    const { sabado } = (await pedir(cookieAdmin, "GET", "/api/sabados/actual")).json();
    const { pago } = (await pedir(cookieAdmin, "POST", `/api/sabados/${sabado.id}/invitados`, { medio: "EFECTIVO" })).json();
    expect((await pedir(cookieAdmin, "POST", `/api/pagos/${pago.id}/anular`, { motivo: "Error de carga" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "POST", `/api/pagos/${pago.id}/anular`, { motivo: "no" })).statusCode).toBe(400);
    expect((await pedir(cookieDueno, "POST", `/api/pagos/${pago.id}/anular`, { motivo: "Error de carga" })).statusCode).toBe(200);
  });

  it("no acepta un día que no es sábado", async () => {
    expect((await pedir(cookieAdmin, "POST", "/api/sabados", { fecha: "2026-11-23" })).statusCode).toBe(400);
  });
});

describe("API de cocina y link del responsable", () => {
  it("flujo completo: asignar, adelantar, gasto, ver desde el link, cerrar y el link deja de andar", async () => {
    const { sabado } = (await pedir(cookieAdmin, "POST", "/api/sabados", { fecha: "2027-03-06" })).json();
    const creada = await pedir(cookieAdmin, "POST", `/api/sabados/${sabado.id}/cocina`, { camada: "2015", responsableNombre: "Agustín" });
    expect(creada.statusCode).toBe(201);
    const { cocina, token } = creada.json();
    expect(JSON.stringify(creada.json().cocina)).not.toContain("tokenHash");

    expect((await pedir(cookieAdmin, "POST", `/api/cocinas/${cocina.id}/adelantos`, { montoCentavos: "30000000", medio: "TRANSFERENCIA" })).statusCode).toBe(201);
    const gasto = await pedir(cookieAdmin, "POST", `/api/cocinas/${cocina.id}/gastos`, {
      proveedor: "Carnicería",
      items: [
        { descripcion: "Vacío", cantidad: "15 kg", categoria: "CARNE", subtotalCentavos: "12000000" },
        { descripcion: "Chorizo", categoria: "CARNE", subtotalCentavos: "4400000" },
      ],
    });
    expect(gasto.statusCode).toBe(201);

    const publica = await app.inject({ method: "GET", url: `/api/publico/cocina/${token}` });
    expect(publica.statusCode).toBe(200);
    expect(publica.json()).toMatchObject({ camada: "2015", recibidoCentavos: "30000000", gastadoCentavos: "16400000", saldoCentavos: "13600000" });
    // La página pública no muestra datos de los administradores.
    expect(JSON.stringify(publica.json())).not.toMatch(/registradoPor|adminId|asiento/);

    const cierre = await pedir(cookieAdmin, "POST", `/api/cocinas/${cocina.id}/cerrar`, { forma: "DEVOLUCION_TRANSFERENCIA" });
    expect(cierre.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/publico/cocina/${token}` })).statusCode).toBe(404);

    const resumen = (await pedir(cookieAdmin, "GET", `/api/cocinas/${cocina.id}`)).json();
    expect(resumen.saldoCentavos).toBe("0");
    expect(resumen.devueltoCentavos).toBe("13600000");
  });

  it("un link inventado no da información", async () => {
    expect((await app.inject({ method: "GET", url: "/api/publico/cocina/inventado-inventado-inventado" })).statusCode).toBe(404);
  });

  it("valida los productos del gasto", async () => {
    const { sabado } = (await pedir(cookieAdmin, "POST", "/api/sabados", { fecha: "2027-03-13" })).json();
    const { cocina } = (await pedir(cookieAdmin, "POST", `/api/sabados/${sabado.id}/cocina`, { camada: "2016", responsableNombre: "Lucas" })).json();
    const malos = [
      { items: [] },
      { items: [{ descripcion: "Pan", categoria: "COMIDA", subtotalCentavos: "100" }] },
      { items: [{ descripcion: "Pan", categoria: "INSUMOS", subtotalCentavos: "10.5" }] },
    ];
    for (const cuerpo of malos) {
      expect((await pedir(cookieAdmin, "POST", `/api/cocinas/${cocina.id}/gastos`, cuerpo)).statusCode).toBe(400);
    }
  });
});
