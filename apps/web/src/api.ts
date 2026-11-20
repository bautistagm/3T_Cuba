/** Cliente de la API. Todo va a la misma dirección de la app; la sesión viaja en una cookie segura. */

export type Rol = "DUENO" | "ADMIN";

export interface Admin {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface AdminListado extends Admin {
  telefono: string | null;
  activo: boolean;
  creadoEn: string;
}

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

async function pedir<T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      credentials: "same-origin",
      headers: cuerpo === undefined ? {} : { "content-type": "application/json" },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, "SIN_CONEXION", "No hay conexión con el servidor. Revisá internet y probá de nuevo.");
  }
  const datos: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const error = (datos as { error?: { codigo?: string; mensaje?: string } } | null)?.error;
    throw new ErrorApi(respuesta.status, error?.codigo ?? "ERROR", error?.mensaje ?? "Algo salió mal. Probá de nuevo.");
  }
  return datos as T;
}

export const api = {
  estadoInstalacion: () => pedir<{ necesitaDueno: boolean; habilitada: boolean }>("GET", "/instalacion"),
  instalar: (datos: { codigo: string; nombre: string; email: string; contrasena: string }) =>
    pedir<{ admin: Admin }>("POST", "/instalacion", datos),
  yo: () => pedir<{ admin: Admin }>("GET", "/auth/yo"),
  login: (email: string, contrasena: string) => pedir<{ admin: Admin }>("POST", "/auth/login", { email, contrasena }),
  logout: () => pedir<{ ok: true }>("POST", "/auth/logout"),
  listarAdmins: () => pedir<{ admins: AdminListado[] }>("GET", "/admins"),
  crearAdmin: (datos: { nombre: string; email: string; telefono?: string; contrasena: string }) =>
    pedir<{ admin: AdminListado }>("POST", "/admins", datos),
  desactivarAdmin: (id: string) => pedir<{ admin: AdminListado }>("POST", `/admins/${id}/desactivar`),
};
