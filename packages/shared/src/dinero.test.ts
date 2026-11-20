import { describe, expect, it } from "vitest";
import {
  MONTO_MAXIMO_CENTAVOS,
  MontoInvalidoError,
  centavosATexto,
  centavosSchema,
  formatearPesos,
  montoPositivoSchema,
  pesosACentavos,
  sumarCentavos,
} from "./dinero.js";

describe("pesosACentavos", () => {
  it.each([
    ["30000", 3_000_000n],
    ["30.000", 3_000_000n],
    ["$30.000", 3_000_000n],
    ["$ 30.000", 3_000_000n],
    ["  30.000  ", 3_000_000n],
    ["1.250,50", 125_050n],
    ["1.250,5", 125_050n],
    ["0,01", 1n],
    ["1.000.000", 100_000_000n],
    ["45000,99", 4_500_099n],
  ])('"%s" → %s centavos', (texto, esperado) => {
    expect(pesosACentavos(texto)).toBe(esperado);
  });

  it.each([
    "",
    "abc",
    "30.5", // en Argentina el punto no es decimal
    "30,000.50", // formato en inglés
    "30.00", // grupo de miles incompleto
    "1,234", // más de 2 decimales
    "-500",
    "30 000",
    "1e5",
    "0",
    "0,00",
  ])('rechaza "%s"', (texto) => {
    expect(() => pesosACentavos(texto)).toThrow(MontoInvalidoError);
  });

  it("rechaza montos por encima del tope de seguridad", () => {
    expect(() => pesosACentavos("10.000.000.001")).toThrow(MontoInvalidoError);
    expect(pesosACentavos("10.000.000.000")).toBe(MONTO_MAXIMO_CENTAVOS);
  });
});

describe("formatearPesos", () => {
  it.each([
    [3_000_000n, "$30.000"],
    [125_050n, "$1.250,50"],
    [125_005n, "$1.250,05"],
    [1n, "$0,01"],
    [0n, "$0"],
    [-112_000_000n, "-$1.120.000"],
    [100_000_000_000n, "$1.000.000.000"],
  ])("%s centavos → %s", (centavos, esperado) => {
    expect(formatearPesos(centavos)).toBe(esperado);
  });

  it("ida y vuelta: formatear y volver a leer da el mismo monto", () => {
    for (const centavos of [1n, 99n, 100n, 125_050n, 3_000_000n, 987_654_321n]) {
      expect(pesosACentavos(formatearPesos(centavos))).toBe(centavos);
    }
  });
});

describe("sumarCentavos", () => {
  it("suma sin errores de redondeo", () => {
    // Con floats, 0.1 + 0.2 da 0.30000000000000004. Con centavos enteros no pasa.
    expect(sumarCentavos([10n, 20n])).toBe(30n);
    expect(sumarCentavos(Array.from({ length: 150 }, () => 3_000_000n))).toBe(450_000_000n);
  });

  it("una lista vacía suma cero", () => {
    expect(sumarCentavos([])).toBe(0n);
  });
});

describe("esquemas de la API", () => {
  it("centavosSchema lee texto de centavos, incluidos negativos", () => {
    expect(centavosSchema.parse("3000000")).toBe(3_000_000n);
    expect(centavosSchema.parse("-500")).toBe(-500n);
    expect(centavosATexto(3_000_000n)).toBe("3000000");
  });

  it.each(["30.000", "30000.5", "1e5", "", "abc", "1234567890123456"])('centavosSchema rechaza "%s"', (texto) => {
    expect(centavosSchema.safeParse(texto).success).toBe(false);
  });

  it("montoPositivoSchema rechaza cero, negativos y montos sobre el tope", () => {
    expect(montoPositivoSchema.parse("1")).toBe(1n);
    expect(montoPositivoSchema.safeParse("0").success).toBe(false);
    expect(montoPositivoSchema.safeParse("-1").success).toBe(false);
    expect(montoPositivoSchema.safeParse((MONTO_MAXIMO_CENTAVOS + 1n).toString()).success).toBe(false);
  });
});
