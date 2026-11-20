import { hash, verify } from "@node-rs/argon2";

/** Largo mínimo de contraseña para administradores. */
export const LARGO_MINIMO_CONTRASENA = 10;

/** Hash con Argon2id (el algoritmo recomendado hoy para contraseñas). Nunca se guarda la contraseña. */
export function hashearContrasena(contrasena: string): Promise<string> {
  return hash(contrasena);
}

export async function verificarContrasena(hashGuardado: string, contrasena: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, contrasena);
  } catch {
    return false;
  }
}

// Hash de una contraseña al azar, para comparar cuando el email no existe y que la respuesta tarde
// lo mismo. Así nadie puede averiguar qué emails son de administradores midiendo el tiempo.
let hashDeRelleno: Promise<string> | undefined;
export function obtenerHashDeRelleno(): Promise<string> {
  hashDeRelleno ??= hash(crypto.randomUUID());
  return hashDeRelleno;
}
