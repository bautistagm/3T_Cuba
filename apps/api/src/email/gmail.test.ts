import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearDueno, crearAdmin } from "../admins/admins.js";
import { COOKIE_SESION, construirApp } from "../app.js";
import type { ConexionBase } from "../db/cliente.js";
import { configDePrueba, prepararBaseLimpia } from "../pruebas/base.js";
import { cifrar, completarConexion, crearEnviadorGmailApi, descifrar, gmailConectado, linkParaConectar, type ConfigGoogle } from "./gmail.js";

let conexion: ConexionBase;
let duenoId = "";
type Pedido = { url: string; cuerpo: string; auth: string | null };
let pedidos: Pedido[] = [];
let emailDeLaCuenta = "plantelcuba@gmail.com";
let tokenRechazado = false;

const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email, email_verified: true })).toString("base64url")}.y`;
/** Google de mentira: el endpoint de claves y el de envío. */
const google: typeof fetch = async (entrada, init) => {
  const url = String(entrada);
  const cuerpo = typeof init?.body === "string" ? init.body : (init?.body?.toString() ?? "");
  pedidos.push({ url, cuerpo, auth: new Headers(init?.headers).get("authorization") });
  if (url === "https://oauth2.googleapis.com/token") {
    const params = new URLSearchParams(cuerpo);
    if (params.get("grant_type") === "authorization_code") {
      return Response.json({ refresh_token: "refresh-de-prueba", access_token: "a1", id_token: idToken(emailDeLaCuenta) });
    }
    if (tokenRechazado) return Response.json({ error: "invalid_grant" }, { status: 400 });
    return Response.json({ access_token: "acceso-de-prueba", expires_in: 3600 });
  }
  if (url.startsWith("https://gmail.googleapis.com/")) return Response.json({ id: "m1" });
  return new Response("no", { status: 404 });
};
const cfg: ConfigGoogle = { clientId: "cliente-de-prueba", clientSecret: "secreto-de-prueba-123", casilla: "plantelcuba@gmail.com", urlPublica: "https://3t.ejemplo.com", fetch: google };
const estadoDe = (url: string) => new URL(url).searchParams.get("state") ?? "";

beforeAll(async () => {
  conexion = await prepararBaseLimpia();
  duenoId = (await crearDueno(conexion.db, { nombre: "Bautista", email: "b@ejemplo.com", contrasena: "clave-del-dueno-1" })).id;
});
afterAll(async () => {
  await conexion.cerrar();
});

describe("conexión con Gmail", () => {
  it("la clave se guarda cifrada y solo se abre con el secreto correcto", () => {
    const guardada = cifrar("refresh-de-prueba", "secreto-1");
    expect(guardada).not.toContain("refresh");
    expect(descifrar(guardada, "secreto-1")).toBe("refresh-de-prueba");
    expect(descifrar(guardada, "otro-secreto")).toBeNull();
    expect(descifrar("cualquier.cosa.rota", "secreto-1")).toBeNull();
  });

  it("el link pide solo permiso para enviar, para la casilla del plantel", async () => {
    const url = new URL(await linkParaConectar(conexion.db, cfg, duenoId));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).not.toContain("gmail.readonly");
    expect(url.searchParams.get("login_hint")).toBe("plantelcuba@gmail.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://3t.ejemplo.com/api/email/google/vuelta");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("si entra con otra cuenta, no la acepta", async () => {
    emailDeLaCuenta = "otra@gmail.com";
    const estado = estadoDe(await linkParaConectar(conexion.db, cfg, duenoId));
    await expect(completarConexion(conexion.db, cfg, "codigo", estado)).rejects.toMatchObject({ codigo: "OTRA_CASILLA" });
    expect(await gmailConectado(conexion.db, cfg)).toBe(false);
    emailDeLaCuenta = "plantelcuba@gmail.com";
  });

  it("con la casilla correcta queda conectada; el link no se puede reusar", async () => {
    const estado = estadoDe(await linkParaConectar(conexion.db, cfg, duenoId));
    await expect(completarConexion(conexion.db, cfg, "codigo", "estado-inventado")).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
    const estado2 = estadoDe(await linkParaConectar(conexion.db, cfg, duenoId));
    expect(estado2).not.toBe(estado);
    await completarConexion(conexion.db, cfg, "codigo", estado2);
    expect(await gmailConectado(conexion.db, cfg)).toBe(true);
    await expect(completarConexion(conexion.db, cfg, "codigo", estado2)).rejects.toMatchObject({ codigo: "ESTADO_INVALIDO" });
  });

  it("manda el email por la API de Gmail, con los QR adjuntos", async () => {
    pedidos = [];
    const enviador = crearEnviadorGmailApi(conexion.db, cfg);
    expect(await enviador.disponible()).toBe(true);
    await enviador.enviar({
      para: "ana@ejemplo.com",
      asunto: "Tus entradas",
      html: '<img src="cid:qr-1@3t">',
      texto: "Tus entradas",
      adjuntos: [{ nombre: "entrada-1.png", contenido: Buffer.from("\x89PNG-falso"), cid: "qr-1@3t" }],
    });
    const envio = pedidos.find((p) => p.url.includes("gmail.googleapis.com"));
    expect(envio?.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(envio?.auth).toBe("Bearer acceso-de-prueba");
    const crudo = Buffer.from(JSON.parse(envio?.cuerpo ?? "{}").raw, "base64url").toString();
    expect(crudo).toMatch(/^To: ana@ejemplo\.com$/m);
    expect(crudo).toMatch(/^From: .*<plantelcuba@gmail\.com>$/m);
    expect(crudo).toContain("Content-ID: <qr-1@3t>");
    // La clave de acceso se reusa mientras no vence.
    await enviador.enviar({ para: "b@ejemplo.com", asunto: "x", html: "x", texto: "x", adjuntos: [] });
    expect(pedidos.filter((p) => p.url.includes("oauth2")).length).toBe(1);
  });

  it("si Google cortó el permiso, avisa que hay que volver a conectar", async () => {
    tokenRechazado = true;
    const otroCfg = { ...cfg, clientId: "otro-cliente" }; // sin clave de acceso en memoria del caso anterior
    const enviador = crearEnviadorGmailApi(conexion.db, otroCfg);
    await expect(enviador.enviar({ para: "x@ejemplo.com", asunto: "x", html: "x", texto: "x", adjuntos: [] })).rejects.toMatchObject({ codigo: "NO_CONECTADO" });
    tokenRechazado = false;
  });
});

describe("API de Gmail", () => {
  let app: FastifyInstance;
  let cookieDueno = "";
  let cookieJuan = "";
  beforeAll(async () => {
    app = await construirApp({ db: conexion.db, config: { ...configDePrueba, GOOGLE_CLIENT_ID: "cliente-de-prueba", GOOGLE_CLIENT_SECRET: "secreto-de-prueba-123" } });
    await crearAdmin(conexion.db, { tipo: "ADMIN", adminId: duenoId, rol: "DUENO" }, { nombre: "Juan", email: "j@ejemplo.com", contrasena: "clave-de-juan-12" });
    const entrar = async (email: string, contrasena: string, ip: string) => {
      const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, contrasena }, remoteAddress: ip });
      return `${COOKIE_SESION}=${r.cookies.find((c) => c.name === COOKIE_SESION)?.value ?? ""}`;
    };
    cookieDueno = await entrar("b@ejemplo.com", "clave-del-dueno-1", "10.12.0.1");
    cookieJuan = await entrar("j@ejemplo.com", "clave-de-juan-12", "10.12.0.2");
  });
  afterAll(async () => {
    await app.close();
  });

  it("solo el dueño conecta; la vuelta con error o con un estado falso vuelve a Ajustes con el motivo", async () => {
    expect((await app.inject({ method: "POST", url: "/api/email/google/conectar", headers: { cookie: cookieJuan } })).statusCode).toBe(403);
    const r = await app.inject({ method: "POST", url: "/api/email/google/conectar", headers: { cookie: cookieDueno } });
    expect(r.json().url).toContain("accounts.google.com");
    const negado = await app.inject({ method: "GET", url: "/api/email/google/vuelta?error=access_denied" });
    expect(negado.statusCode).toBe(302);
    expect(negado.headers.location).toContain("/ajustes?gmail=error");
    const falso = await app.inject({ method: "GET", url: "/api/email/google/vuelta?code=x&state=inventado" });
    expect(decodeURIComponent(String(falso.headers.location))).toContain("venció o no es válido");
    expect((await app.inject({ method: "GET", url: "/api/email/estado", headers: { cookie: cookieDueno } })).json()).toMatchObject({ configurado: true, casilla: "plantelcuba@gmail.com" });
  });
});
