/**
 * Link de WhatsApp para un celular argentino (wa.me/549XXXXXXXXXX).
 * Acepta "11 5555-1234", "011 15 5555-1234", "+54 9 11 5555-1234", etc.
 * Devuelve null si no parece un celular argentino, para no mandar mensajes a cualquier número.
 */
export function numeroWhatsApp(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  let d = telefono.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // El "15" de los celulares va después del código de área (de 2 a 4 números): 11 15 5555-1234.
  if (d.length === 12) {
    for (const largoArea of [2, 3, 4]) {
      if (d.slice(largoArea, largoArea + 2) === "15") {
        d = d.slice(0, largoArea) + d.slice(largoArea + 2);
        break;
      }
    }
  }
  if (d.length !== 10 || !/^[1-9]/.test(d)) return null;
  return `549${d}`;
}

export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): string | null {
  const numero = numeroWhatsApp(telefono);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}` : null;
}
