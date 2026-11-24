import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearAdmin, crearDueno } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";

let conexion: ConexionBase;
let app: FastifyInstance;
let cookieDueno = "";
let cookieJuan = "";
let ip = 1;
async function entrar(email: string, contrasena: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: `10.7.0.${ip++}` });
  return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
}
const pedir = (cookie: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  app = await construirApp({ db: conexion.db, config: configDePrueba });
  const d = await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" });
  await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: d.id, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
  cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1");
  cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12");
});
afterAll(async () => {
  await app.close();
  await conexion.cerrar();
});

describe("API de jugadores", () => {
  it("alta, búsqueda, edición y baja con los permisos de cada uno", async () => {
    const alta = await pedir(cookieJuan, "POST", "/api/jugadores", { nombre: "Mateo", apellido: "Fernández", dni: "44.000.001", camada: "2006" });
    expect(alta.statusCode).toBe(201);
    const id = alta.json().jugador.id;
    expect((await pedir(cookieJuan, "POST", "/api/jugadores", { nombre: "X", apellido: "Y", dni: "44000001" })).statusCode).toBe(409);
    expect((await pedir(cookieJuan, "POST", "/api/jugadores", { nombre: "X", apellido: "Y", dni: "12" })).statusCode).toBe(400);

    const lista = (await pedir(cookieJuan, "GET", "/api/jugadores?buscar=fernandez")).json();
    expect(lista.jugadores).toHaveLength(1);
    expect(lista.totales).toEqual({ activos: 1, baja: 0 });

    expect((await pedir(cookieJuan, "PATCH", `/api/jugadores/${id}`, { camada: "2007" })).json().jugador.camada).toBe("2007");
    expect((await pedir(cookieJuan, "POST", `/api/jugadores/${id}/baja`)).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "POST", `/api/jugadores/${id}/baja`)).json().jugador.estado).toBe("BAJA");
    expect((await pedir(cookieJuan, "POST", `/api/jugadores/${id}/eliminar`, { confirmacion: "Mateo Fernández" })).statusCode).toBe(403);
    expect((await pedir(cookieDueno, "POST", `/api/jugadores/${id}/eliminar`, { confirmacion: "Mateo Fernandez" })).json()).toEqual({ borrado: true, anonimizado: false });
  });

  it("importar: solo el dueño, primero muestra la vista previa", async () => {
    const csv = "Nombre,Apellido,DNI,Camada\nAna,Prueba,45000001,2008\nBeto,Prueba,mal,2008";
    expect((await pedir(cookieJuan, "POST", "/api/jugadores/importar/analizar", { csv })).statusCode).toBe(403);
    const vista = (await pedir(cookieDueno, "POST", "/api/jugadores/importar/analizar", { csv })).json();
    expect(vista.resumen).toEqual({ nuevos: 1, yaEstan: 0, conError: 1 });
    expect(vista.filas[0]).not.toHaveProperty("datos");
    expect((await pedir(cookieDueno, "POST", "/api/jugadores/importar", { csv })).json().importados).toBe(1);
  });
});
