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

async function pedir<T>(metodo: "GET" | "POST" | "PUT", ruta: string, cuerpo?: unknown): Promise<T> {
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

export type Medio = "EFECTIVO" | "TRANSFERENCIA";
export type Categoria = "CARNE" | "BEBIDAS" | "INSUMOS" | "OTROS";
export type Estado = "CONFIRMADO" | "ANULADO";

export interface Sabado {
  id: string;
  fecha: string;
  esLocal: boolean;
}

export interface Cobro {
  id: string;
  montoCentavos: string;
  medio: Medio;
  fecha: string;
  nombrePagador: string | null;
  camadaPagador: string | null;
  nota: string | null;
  registradoPorAdminId: string | null;
  estado: Estado;
  motivoAnulacion: string | null;
}

export interface ItemGasto {
  descripcion: string;
  cantidad: string | null;
  categoria: Categoria;
  subtotalCentavos: string;
}

export interface Gasto {
  id: string;
  fecha: string;
  proveedor: string | null;
  descripcion: string;
  totalCentavos: string;
  origenCarga: "IA" | "MANUAL";
  estado: Estado;
  motivoAnulacion: string | null;
  registradoPorAdminId: string | null;
  items: ItemGasto[];
}

export interface MovimientoCocina {
  id: string;
  tipo: "ADELANTO" | "DEVOLUCION" | "REINTEGRO" | "SOBRANTE_NO_DEVUELTO" | "EXCESO_NO_REINTEGRADO";
  montoCentavos: string;
  medio: Medio | null;
  nota: string | null;
  registradoPorAdminId: string;
  estado: Estado;
  creadoEn: string;
}

export interface ResumenCocina {
  cocina: {
    id: string;
    sabadoId: string;
    camada: string;
    responsableNombre: string;
    responsableTelefono: string | null;
    estado: "ABIERTA" | "CERRADA";
    notaCierre: string | null;
  };
  adelantadoCentavos: string;
  gastadoCentavos: string;
  devueltoCentavos: string;
  reintegradoCentavos: string;
  saldoCentavos: string;
  movimientos: MovimientoCocina[];
  gastos: Gasto[];
}

export interface DetalleSabado {
  sabado: Sabado;
  precioInvitadoCentavos: string | null;
  invitados: number;
  cobradoCentavos: string;
  cobros: Cobro[];
  cocina: ResumenCocina | null;
  nombresAdmins: Record<string, string>;
}

export interface FilaSabado {
  id: string;
  fecha: string;
  esLocal: boolean;
  invitados: number;
  cobradoCentavos: string;
}

export interface LecturaIa {
  proveedor: string | null;
  items: { descripcion: string; cantidad: string | null; categoria: Categoria; importe_centavos: number }[];
}

export interface Ticket {
  id: string;
  estado: "REGISTRADO" | "REVISAR" | "DESCARTADO";
  motivoRevision: string | null;
  lecturaIa: LecturaIa | null;
  gastoId: string | null;
  creadoEn: string;
}

export type FormaCierre =
  | "SIN_DIFERENCIA"
  | "DEVOLUCION_TRANSFERENCIA"
  | "DEVOLUCION_EFECTIVO"
  | "REINTEGRO_TRANSFERENCIA"
  | "REINTEGRO_EFECTIVO"
  | "SOBRANTE_NO_DEVUELTO"
  | "EXCESO_NO_REINTEGRADO";

export interface PaginaResponsable {
  camada: string;
  responsable: string;
  fecha: string;
  recibidoCentavos: string;
  gastadoCentavos: string;
  saldoCentavos: string;
  ticketsEnRevision: number;
  gastos: { id: string; fecha: string; proveedor: string | null; totalCentavos: string; items: { descripcion: string; cantidad: string | null; subtotalCentavos: string }[] }[];
}

type ItemParaEnviar = { descripcion: string; cantidad?: string; categoria: Categoria; subtotalCentavos: string };

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

  sabadoActual: () => pedir<DetalleSabado>("GET", "/sabados/actual"),
  sabado: (id: string) => pedir<DetalleSabado>("GET", `/sabados/${id}`),
  sabadoDeFecha: (fecha: string) => pedir<DetalleSabado>("POST", "/sabados", { fecha }),
  listarSabados: () => pedir<{ sabados: FilaSabado[] }>("GET", "/sabados"),
  marcarLocal: (id: string, esLocal: boolean) => pedir<DetalleSabado>("POST", `/sabados/${id}/local`, { esLocal }),
  fijarPrecioInvitado: (montoCentavos: string) => pedir<unknown>("PUT", "/parametros/precio-invitado", { montoCentavos }),
  cobrarInvitado: (sabadoId: string, datos: { medio: Medio; nombre?: string; camada?: string; nota?: string }) =>
    pedir<{ pago: Cobro }>("POST", `/sabados/${sabadoId}/invitados`, datos),
  anularPago: (id: string, motivo: string) => pedir<unknown>("POST", `/pagos/${id}/anular`, { motivo }),

  crearCocina: (sabadoId: string, datos: { camada: string; responsableNombre: string; responsableTelefono?: string }) =>
    pedir<{ cocina: ResumenCocina["cocina"]; token: string }>("POST", `/sabados/${sabadoId}/cocina`, datos),
  cocina: (id: string) => pedir<ResumenCocina>("GET", `/cocinas/${id}`),
  nuevoLinkCocina: (id: string) => pedir<{ token: string }>("POST", `/cocinas/${id}/link`),
  adelantar: (id: string, datos: { montoCentavos: string; medio: Medio; nota?: string }) =>
    pedir<unknown>("POST", `/cocinas/${id}/adelantos`, datos),
  gastoManual: (id: string, datos: { proveedor?: string; items: ItemParaEnviar[] }) => pedir<unknown>("POST", `/cocinas/${id}/gastos`, datos),
  cerrarCocina: (id: string, forma: FormaCierre, motivo?: string) =>
    pedir<unknown>("POST", `/cocinas/${id}/cerrar`, motivo ? { forma, motivo } : { forma }),
  anularGasto: (id: string, motivo: string) => pedir<unknown>("POST", `/gastos/${id}/anular`, { motivo }),
  anularMovimientoCocina: (id: string, motivo: string) => pedir<unknown>("POST", `/movimientos-cocina/${id}/anular`, { motivo }),

  subirTicket: (cocinaId: string, imagenBase64: string) =>
    pedir<{ estado: "REGISTRADO" | "REVISAR"; motivoRevision: string | null }>("POST", `/cocinas/${cocinaId}/tickets`, { imagenBase64 }),
  ticketsDeCocina: (cocinaId: string) => pedir<{ tickets: Ticket[] }>("GET", `/cocinas/${cocinaId}/tickets`),
  resolverTicket: (id: string, datos: { proveedor?: string; items: ItemParaEnviar[] }) => pedir<unknown>("POST", `/tickets/${id}/resolver`, datos),
  descartarTicket: (id: string, motivo: string) => pedir<unknown>("POST", `/tickets/${id}/descartar`, { motivo }),

  paginaResponsable: (token: string) => pedir<PaginaResponsable>("GET", `/publico/cocina/${token}`),
  subirTicketResponsable: (token: string, imagenBase64: string) =>
    pedir<{ estado: "REGISTRADO" | "REVISAR"; motivoRevision: string | null }>("POST", `/publico/cocina/${token}/tickets`, { imagenBase64 }),
};
