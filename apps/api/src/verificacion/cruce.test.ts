import { describe, expect, it } from "vitest";
import { decidir, normalizarCuit, type DatosComprobante, type EntradaCuenta } from "./cruce.js";

const f = (iso: string) => new Date(iso);
// Una transferencia de $1 desde Mercado Pago (datos inventados, con la misma forma que la prueba real del 24/11/2026).
const prueba: EntradaCuenta = {
  mpPagoId: "100200300400",
  e2eId: "0aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  montoCentavos: 100n,
  fecha: f("2026-11-24T09:44:00-03:00"),
  cuitPagador: "27300000001",
};
const comprobanteDePrueba: DatosComprobante = {
  montoCentavos: 100n,
  fecha: f("2026-11-24T09:44:00-03:00"),
  cuitPagador: "27-30000000-1",
  numeroOperacion: "100200300400",
};
const otra = (cambios: Partial<EntradaCuenta>): EntradaCuenta => ({ ...prueba, ...cambios });
const nada = new Set<string>();

describe("regla para confirmar solo", () => {
  it("confirma la transferencia real de prueba por número de operación", () => {
    const d = decidir(comprobanteDePrueba, [prueba], nada);
    expect(d).toMatchObject({ resultado: "CONFIRMAR", por: "NUMERO_OPERACION", entrada: { mpPagoId: "100200300400" } });
  });

  it("también reconoce el código largo de la transferencia, escrito con o sin guiones", () => {
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: "0AAAAAAABBBB4CCC8DDDEEEEEEEEEEEE" }, [prueba], nada);
    expect(d.resultado).toBe("CONFIRMAR");
  });

  it("desde un banco (sin número que coincida): confirma por CUIT si es el único candidato", () => {
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: "COELSA-998877" }, [prueba], nada);
    expect(d).toMatchObject({ resultado: "CONFIRMAR", por: "CUIT" });
  });

  it("nunca usa dos veces el mismo movimiento", () => {
    const usados = new Set(["100200300400"]);
    expect(decidir(comprobanteDePrueba, [prueba], usados)).toMatchObject({ resultado: "REVISAR", codigo: "YA_USADO" });
    expect(decidir({ ...comprobanteDePrueba, numeroOperacion: null }, [prueba], usados)).toMatchObject({
      resultado: "REVISAR",
      codigo: "YA_USADO",
    });
  });

  it("monto distinto al centavo: a revisar", () => {
    const d = decidir({ ...comprobanteDePrueba, montoCentavos: 101n }, [prueba], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "CONTRADICE" });
  });

  it("monto distinto al que había que pagar: a revisar", () => {
    const d = decidir(comprobanteDePrueba, [prueba], nada, 1500000n);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "MONTO_DISTINTO_AL_ESPERADO" });
  });

  it("número que coincide pero CUIT distinto: a revisar", () => {
    const d = decidir({ ...comprobanteDePrueba, cuitPagador: "20-11111111-2" }, [prueba], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "CONTRADICE" });
  });

  it("número que coincide pero fecha lejana: a revisar", () => {
    const d = decidir({ ...comprobanteDePrueba, fecha: f("2026-11-01T10:00:00-03:00") }, [prueba], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "CONTRADICE" });
  });

  it("por CUIT con dos transferencias iguales esos días: a revisar", () => {
    const segunda = otra({ mpPagoId: "100200300401", e2eId: null, fecha: f("2026-11-25T10:00:00-03:00") });
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: null }, [prueba, segunda], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "VARIOS_CANDIDATOS" });
    if (d.resultado === "REVISAR") expect(d.candidatos).toHaveLength(2);
  });

  it("por CUIT, si una de las dos ya se usó, confirma la otra", () => {
    const segunda = otra({ mpPagoId: "100200300401", e2eId: null, fecha: f("2026-11-25T10:00:00-03:00") });
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: null }, [prueba, segunda], new Set(["100200300400"]));
    expect(d).toMatchObject({ resultado: "CONFIRMAR", entrada: { mpPagoId: "100200300401" } });
  });

  it("por CUIT con fecha a más de 3 días: no la toma", () => {
    const vieja = otra({ fecha: f("2026-11-19T09:00:00-03:00") });
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: null }, [vieja], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "NO_FIGURA" });
  });

  it("misma plata pero de otro CUIT: a revisar, nunca la asigna", () => {
    const deOtro = otra({ cuitPagador: "20999999993" });
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: null }, [deOtro], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "CONTRADICE" });
  });

  it("sin CUIT ni número que coincida: no adivina", () => {
    const d = decidir({ montoCentavos: 100n, fecha: comprobanteDePrueba.fecha, cuitPagador: null, numeroOperacion: null }, [prueba], nada);
    expect(d).toMatchObject({ resultado: "REVISAR", codigo: "SIN_FORMA_DE_IDENTIFICAR" });
  });

  it("todavía no figura: a revisar (se puede volver a verificar después)", () => {
    expect(decidir(comprobanteDePrueba, [], nada)).toMatchObject({ resultado: "REVISAR", codigo: "NO_FIGURA" });
  });

  it("sin monto legible: a revisar", () => {
    expect(decidir({ ...comprobanteDePrueba, montoCentavos: null }, [prueba], nada)).toMatchObject({ codigo: "ILEGIBLE" });
  });

  it("un número de operación muy corto no alcanza para confirmar", () => {
    const corta = otra({ mpPagoId: "12345", cuitPagador: null });
    const d = decidir({ ...comprobanteDePrueba, numeroOperacion: "12345", cuitPagador: null }, [corta], nada);
    expect(d.resultado).toBe("REVISAR");
  });

  it("CUIT: acepta con o sin guiones y descarta lo que no tiene 11 dígitos", () => {
    expect(normalizarCuit("27-30000000-1")).toBe("27300000001");
    expect(normalizarCuit("2730000000")).toBeNull();
    expect(normalizarCuit(null)).toBeNull();
  });
});
