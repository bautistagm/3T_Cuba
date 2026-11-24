import { describe, expect, it } from "vitest";
import { dniDeCuil, formatearDni, normalizarDni } from "./dni.js";

describe("DNI", () => {
  it("acepta el DNI con o sin puntos y lo guarda solo con números", () => {
    expect(normalizarDni("30.123.456")).toBe("30123456");
    expect(normalizarDni(" 30 123 456 ")).toBe("30123456");
    expect(normalizarDni("7.123.456")).toBe("7123456");
    expect(normalizarDni("07123456")).toBe("7123456");
  });

  it("rechaza lo que no es un DNI", () => {
    for (const malo of ["", "abc", "123", "123456", "123456789", "30.123.456a", "20-30123456-7", "0000000"]) {
      expect(normalizarDni(malo), malo).toBeNull();
    }
    expect(normalizarDni(null)).toBeNull();
  });

  it("saca el DNI de los 8 números del medio del CUIL", () => {
    expect(dniDeCuil("20-30123456-7")).toBe("30123456");
    expect(dniDeCuil("27301234561")).toBe("30123456");
    expect(dniDeCuil("23-45678901-9")).toBe("45678901");
    expect(dniDeCuil("20-07123456-3")).toBe("7123456");
  });

  it("si no es un CUIL de 11 números, no inventa un DNI", () => {
    expect(dniDeCuil("2030123456")).toBeNull();
    expect(dniDeCuil(null)).toBeNull();
    expect(dniDeCuil("20-00000000-1")).toBeNull();
  });

  it("muestra el DNI con puntos", () => {
    expect(formatearDni("30123456")).toBe("30.123.456");
    expect(formatearDni("7123456")).toBe("7.123.456");
  });
});
