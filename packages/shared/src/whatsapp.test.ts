import { describe, expect, it } from "vitest";
import { enlaceWhatsApp, numeroWhatsApp } from "./whatsapp.js";

describe("WhatsApp", () => {
  it("entiende los celulares escritos de distintas formas", () => {
    for (const t of ["11 5555-1234", "1155551234", "011 15 5555-1234", "+54 9 11 5555-1234", "5491155551234", "0054 9 11 5555 1234", "11 15 5555 1234"]) {
      expect(numeroWhatsApp(t), t).toBe("5491155551234");
    }
    expect(numeroWhatsApp("0351 15 444-5566")).toBe("5493514445566");
    expect(numeroWhatsApp("2944 15 55-6677")).toBe("5492944556677");
  });

  it("si no parece un celular argentino, no arma el link", () => {
    for (const t of ["", "123", "555-1234", "+1 415 555 1234 99", null]) expect(numeroWhatsApp(t), String(t)).toBeNull();
  });

  it("arma el link con el mensaje", () => {
    expect(enlaceWhatsApp("1155551234", "Hola, ¿todo bien?")).toBe("https://wa.me/5491155551234?text=Hola%2C%20%C2%BFtodo%20bien%3F");
    expect(enlaceWhatsApp(null, "x")).toBeNull();
  });
});
