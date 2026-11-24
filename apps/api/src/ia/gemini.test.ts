import { describe, expect, it } from "vitest";
import { conModelos, explicarErrorIa } from "./gemini.js";

const conEstado = (status: number) => Object.assign(new Error(`{"error":{"code":${status}}}`), { status });
const sinEspera = { esperasMs: [0, 0] };

describe("pedidos a la IA", () => {
  it("si el modelo está saturado, espera y reintenta el mismo", async () => {
    const intentos: string[] = [];
    const r = await conModelos(["a", "b"], async (m) => {
      intentos.push(m);
      if (intentos.length < 3) throw conEstado(503);
      return "ok";
    }, sinEspera);
    expect(r).toBe("ok");
    expect(intentos).toEqual(["a", "a", "a"]);
  });

  it("si un modelo sigue saturado, pasa al siguiente", async () => {
    const intentos: string[] = [];
    const r = await conModelos(["a", "b"], async (m) => {
      intentos.push(m);
      if (m === "a") throw conEstado(503);
      return "ok";
    }, sinEspera);
    expect(r).toBe("ok");
    expect(intentos).toEqual(["a", "a", "a", "b"]);
  });

  it("un modelo que no existe se salta sin reintentar", async () => {
    const intentos: string[] = [];
    await conModelos(["viejo", "nuevo"], async (m) => {
      intentos.push(m);
      if (m === "viejo") throw conEstado(404);
      return "ok";
    }, sinEspera);
    expect(intentos).toEqual(["viejo", "nuevo"]);
  });

  it("una clave mal cargada no se reintenta", async () => {
    const intentos: string[] = [];
    await expect(conModelos(["a", "b"], async (m) => {
      intentos.push(m);
      throw conEstado(403);
    }, sinEspera)).rejects.toMatchObject({ status: 403 });
    expect(intentos).toEqual(["a"]);
  });

  it("explica los errores en castellano, sin texto técnico", () => {
    expect(explicarErrorIa(conEstado(503))).toMatch(/saturada/);
    expect(explicarErrorIa(conEstado(429))).toMatch(/plan gratis/);
    expect(explicarErrorIa(conEstado(403))).toMatch(/GEMINI_API_KEY/);
    expect(explicarErrorIa(new Error('{"error":{"message":"raro"}}'))).not.toContain("{");
  });
});
