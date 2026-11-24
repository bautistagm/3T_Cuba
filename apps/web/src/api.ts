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

async function pedir<T>(metodo: "GET" | "POST" | "PUT" | "PATCH", ruta: string, cuerpo?: unknown): Promise<T> {
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

export interface Traspaso {
  id: string;
  deAdminId: string;
  paraAdminId: string;
  deNombre: string;
  paraNombre: string;
  montoCentavos: string;
  nota: string | null;
  creadoEn: string;
}

export interface EstadoCaja {
  totalCentavos: string;
  cuentaCentavos: string;
  efectivo: { adminId: string; nombre: string; centavos: string }[];
  camadas: { cocinaId: string; camada: string; fecha: string; centavos: string }[];
  miEfectivoCentavos: string;
  ultimoControl: { declaradoCentavos: string; libroCentavos: string; diferenciaCentavos: string; creadoEn: string; ajusteAsientoId: string | null } | null;
  traspasosPendientes: Traspaso[];
  administradores: { id: string; nombre: string }[];
  ticketsParaRevisar: Ticket[];
}

export interface MovimientoCaja {
  id: string;
  fecha: string;
  creadoEn: string;
  descripcion: string;
  origen: string;
  tipo: "ENTRADA" | "SALIDA" | "INTERNO";
  montoCentavos: string;
  categoria: string | null;
  registradoPor: string;
  anulado: boolean;
}

export interface Analisis {
  gastosPorMes: { mes: string; totalCentavos: string; porCategoria: Record<Categoria, string> }[];
  ingresosPorMes: { mes: string; totalCentavos: string; porOrigen: Record<string, string> }[];
  productos: { producto: string; categoria: Categoria; totalCentavos: string; veces: number }[];
}

export interface PruebaMercadoPago {
  cuenta: { id: string; apodo: string | null };
  movimientos: {
    id: string;
    fecha: string | null;
    montoCentavos: string | null;
    estado: string | null;
    tipoOperacion: string | null;
    medio: string | null;
    referencias: { campo: string; valor: string }[];
    pagador: { campo: string; valor: string }[];
  }[];
}


export interface Jugador {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string | null;
  email: string | null;
  camada: string | null;
  estado: "ACTIVO" | "BAJA";
  altaEn: string;
  bajaEn: string | null;
}
export interface DatosJugador {
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string;
  email: string;
  camada: string;
}
export interface VistaImportacion {
  filas: { fila: number; nombre: string; apellido: string; dni: string; camada: string; estado: "NUEVO" | "YA_ESTA" | "ERROR"; motivo: string | null }[];
  resumen: { nuevos: number; yaEstan: number; conError: number };
}

export interface MesCuota {
  id: string;
  anio: number;
  mes: number;
  nombre: string;
  montoCentavos: string;
  nota: string | null;
  pagaron: number;
  deben: number;
  cobradoCentavos: string;
  faltaCentavos: string;
}
export interface Deudor {
  jugadorId: string;
  nombre: string;
  apellido: string;
  telefono: string | null;
  camada: string | null;
  cuotas: { cargoId: string; mes: string; montoCentavos: string }[];
  totalCentavos: string;
}
export interface CuotaJugador {
  id: string;
  periodoId: string;
  mes: string;
  montoCentavos: string;
  estado: "PENDIENTE" | "PAGADO" | "ANULADO";
  pagoId: string | null;
  motivoAnulacion: string | null;
}

export interface EstadoCuenta {
  fechaCorte: string | null;
  ultimaLectura: string | null;
  conectada: boolean;
  paraRevisar: number;
}
export interface TransferenciaParaRevisar {
  mpPagoId: string;
  montoCentavos: string;
  fecha: string;
  cuitPagador: string | null;
  dniPagador: string | null;
  motivo: string | null;
  jugadorSugerido: { id: string; nombre: string } | null;
}
export interface TransferenciaLeida {
  mpPagoId: string;
  montoCentavos: string;
  fecha: string;
  estado: "CONFIRMADA" | "REVISAR" | "RESUELTA";
  resolucion: "CUOTA_AUTO" | "CUOTA_MANUAL" | "YA_REGISTRADA" | "OTRO_INGRESO" | "NO_ES_DEL_PLANTEL" | null;
  jugador: string | null;
  nota: string | null;
}

export interface FiestaListada {
  id: string;
  nombre: string;
  fechaHora: string;
  lugar: string | null;
  estado: "A_LA_VENTA" | "VENTA_CERRADA";
  vendidas: number;
  usadas: number;
  pendientes: number;
}
export interface DetalleFiesta {
  fiesta: { id: string; nombre: string; fechaHora: string; lugar: string | null; estado: "A_LA_VENTA" | "VENTA_CERRADA"; tokenPuerta: string | null };
  tipos: {
    id: string;
    nombre: string;
    precioCentavos: string;
    precioVigenteCentavos: string;
    tokenVenta: string;
    tandas: { id: string; precioCentavos: string; hasta: string; termino: boolean }[];
  }[];
  entradas: {
    id: string;
    compraId: string;
    tipoId: string;
    nombre: string;
    dni: string;
    estado: "PENDIENTE_PAGO" | "VALIDA" | "USADA" | "ANULADA";
    pagadaEn: string | null;
    usadaEn: string | null;
    usadaPor: string | null;
    email: string;
    telefono: string | null;
  }[];
  recaudadoCentavos: string;
  emailConfigurado: boolean;
  /** Estado del último email de cada compra (por id de compra). */
  emails: Record<string, { estado: "PENDIENTE" | "ENVIADA" | "FALLIDA"; error: string | null; enviadaEn: string | null }>;
}
export interface VentaPublica {
  fiesta: { nombre: string; fechaHora: string; lugar: string | null };
  tipo: { nombre: string; precioCentavos: string; tanda: { hasta: string; despuesCentavos: string } | null };
  abierta: boolean;
  alias: string | null;
}
export interface EstadoCompra {
  codigoConsulta: string;
  cantidad: number;
  totalCentavos: string;
  dniPagador: string;
  estado: "PENDIENTE_PAGO" | "PAGADA" | "ANULADA";
  alias: string | null;
  existente: boolean;
  fiesta: { nombre: string; fechaHora: string; lugar: string | null };
  tipo: string;
  entradas: { nombre: string; dni: string; estado: string; codigo: string | null }[];
}
export interface CompraPendiente {
  id: string;
  fiesta: string;
  tipo: string;
  cantidad: number;
  dniPagador: string;
  quienCompra: string;
  creadaEn: string;
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
  jugadores: (filtro: { estado: "ACTIVO" | "BAJA" | "TODOS"; buscar: string }) =>
    pedir<{ jugadores: Jugador[]; totales: { activos: number; baja: number } }>(
      "GET",
      `/jugadores?${new URLSearchParams({ estado: filtro.estado, ...(filtro.buscar.trim() ? { buscar: filtro.buscar.trim() } : {}) }).toString()}`,
    ),
  crearJugador: (datos: DatosJugador) => pedir<{ jugador: Jugador }>("POST", "/jugadores", datos),
  editarJugador: (id: string, datos: Partial<DatosJugador>) => pedir<{ jugador: Jugador }>("PATCH", `/jugadores/${id}`, datos),
  bajaJugador: (id: string) => pedir<{ jugador: Jugador }>("POST", `/jugadores/${id}/baja`),
  reactivarJugador: (id: string) => pedir<{ jugador: Jugador }>("POST", `/jugadores/${id}/reactivar`),
  eliminarJugador: (id: string, confirmacion: string) =>
    pedir<{ borrado: boolean; anonimizado: boolean }>("POST", `/jugadores/${id}/eliminar`, { confirmacion }),
  analizarImportacion: (csv: string) => pedir<VistaImportacion>("POST", "/jugadores/importar/analizar", { csv }),
  importarJugadores: (csv: string) => pedir<{ importados: number }>("POST", "/jugadores/importar", { csv }),
  mesesCuota: () => pedir<{ meses: MesCuota[]; alias: string | null }>("GET", "/cuotas/meses"),
  abrirMes: (datos: { anio: number; mes: number; montoCentavos: string; nota?: string }) =>
    pedir<{ cuotasCargadas: number }>("POST", "/cuotas/meses", datos),
  cambiarMontoMes: (id: string, montoCentavos: string) => pedir<unknown>("PUT", `/cuotas/meses/${id}/monto`, { montoCentavos }),
  deudores: (periodoId?: string) =>
    pedir<{ deudores: Deudor[]; totalCentavos: string; alias: string | null }>("GET", `/cuotas/deudores${periodoId ? `?periodoId=${periodoId}` : ""}`),
  cuotasJugador: (id: string) =>
    pedir<{ cuotas: CuotaJugador[]; mesesSinCuota: { periodoId: string; mes: string; montoCentavos: string }[] }>("GET", `/jugadores/${id}/cuotas`),
  agregarCuota: (jugadorId: string, periodoId: string) => pedir<unknown>("POST", `/jugadores/${jugadorId}/cuotas`, { periodoId }),
  anularCuota: (id: string, motivo: string) => pedir<unknown>("POST", `/cuotas/${id}/anular`, { motivo }),
  cobrarEfectivo: (jugadorId: string, cuotas: string[]) => pedir<unknown>("POST", `/jugadores/${jugadorId}/pagos-efectivo`, { cuotas }),
  fijarAlias: (alias: string) => pedir<unknown>("PUT", "/parametros/alias", { alias }),
  estadoCuenta: () => pedir<EstadoCuenta>("GET", "/cuenta/estado"),
  leerCuentaAhora: () => pedir<{ estado: string; nuevas?: number; confirmadas?: number; paraRevisar?: number; motivo?: string }>("POST", "/cuenta/leer-ahora"),
  fijarFechaCorte: (fecha: string) => pedir<unknown>("PUT", "/cuenta/fecha-corte", { fecha }),
  transferenciasParaRevisar: () => pedir<{ transferencias: TransferenciaParaRevisar[] }>("GET", "/transferencias/revisar"),
  ultimasTransferencias: () => pedir<{ transferencias: TransferenciaLeida[] }>("GET", "/transferencias"),
  asignarTransferencia: (id: string, jugadorId: string, cuotas: string[]) => pedir<unknown>("POST", `/transferencias/${id}/jugador`, { jugadorId, cuotas }),
  transferenciaYaRegistrada: (id: string, nota: string) => pedir<unknown>("POST", `/transferencias/${id}/ya-registrada`, { nota }),
  transferenciaOtroIngreso: (id: string, nota: string) => pedir<unknown>("POST", `/transferencias/${id}/otro-ingreso`, { nota }),
  transferenciaNoEsDelPlantel: (id: string, nota: string) => pedir<unknown>("POST", `/transferencias/${id}/no-es-del-plantel`, { nota }),
  cambiarMiContrasena: (actual: string, nueva: string) => pedir<unknown>("POST", "/auth/contrasena", { actual, nueva }),
  restablecerContrasena: (adminId: string, nueva: string) => pedir<unknown>("POST", `/admins/${adminId}/contrasena`, { nueva }),
  fiestas: () => pedir<{ fiestas: FiestaListada[] }>("GET", "/fiestas"),
  crearFiesta: (datos: { nombre: string; fechaHora: string; lugar?: string; tipos: { nombre: string; precioCentavos: string }[] }) =>
    pedir<{ fiesta: { id: string } }>("POST", "/fiestas", datos),
  fiesta: (id: string) => pedir<DetalleFiesta>("GET", `/fiestas/${id}`),
  ventaFiesta: (id: string, abierta: boolean) => pedir<unknown>("POST", `/fiestas/${id}/venta`, { abierta }),
  antesDeEliminarFiesta: (id: string) => pedir<{ nombre: string; entradas: number; pagos: number; totalCentavos: string }>("GET", `/fiestas/${id}/eliminar`),
  eliminarFiesta: (id: string, plata?: { destino: "DEVUELTA" } | { destino: "QUEDA"; concepto: string }) =>
    pedir<{ ok: true }>("POST", `/fiestas/${id}/eliminar`, plata ? { plata } : {}),
  agregarTanda: (tipoId: string, datos: { precioCentavos: string; hasta: string }) => pedir<{ id: string }>("POST", `/tipos-entrada/${tipoId}/tandas`, datos),
  quitarTanda: (id: string) => pedir<{ ok: true }>("POST", `/tandas/${id}/quitar`),
  nuevoLinkPuerta: (id: string) => pedir<{ tokenPuerta: string }>("POST", `/fiestas/${id}/link-puerta`),
  reenviarEntradas: (compraId: string, email?: string) => pedir<unknown>("POST", `/compras-entradas/${compraId}/reenviar`, email ? { email } : {}),
  anularCompraEntradas: (id: string) => pedir<unknown>("POST", `/compras-entradas/${id}/anular`),
  comprasParaTransferencia: (mpPagoId: string) => pedir<{ compras: CompraPendiente[] }>("GET", `/transferencias/${mpPagoId}/compras`),
  asignarTransferenciaACompra: (mpPagoId: string, compraId: string) => pedir<unknown>("POST", `/transferencias/${mpPagoId}/compra`, { compraId }),
  ventaPublica: (token: string) => pedir<VentaPublica>("GET", `/publico/venta/${token}`),
  comprarEntradas: (token: string, datos: { entradas: { nombre: string; dni: string }[]; email: string; telefono?: string }) =>
    pedir<{ codigoConsulta: string }>("POST", `/publico/venta/${token}/compras`, datos),
  estadoCompra: (codigo: string) => pedir<EstadoCompra>("GET", `/publico/compras/${codigo}`),
  emailDePrueba: () => pedir<{ enviadoA: string }>("POST", "/email/prueba"),
  estadoEmail: () => pedir<{ configurado: boolean; conectado: boolean; casilla: string; direccionDeVuelta: string }>("GET", "/email/estado"),
  conectarGmail: () => pedir<{ url: string }>("POST", "/email/google/conectar"),
  probarMercadoPago: () => pedir<PruebaMercadoPago>("GET", "/mercadopago/prueba"),

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

  caja: () => pedir<EstadoCaja>("GET", "/caja"),
  movimientosCaja: (antesDe?: string) =>
    pedir<{ movimientos: MovimientoCaja[] }>("GET", `/caja/movimientos${antesDe ? `?antesDe=${encodeURIComponent(antesDe)}` : ""}`),
  depositar: (montoCentavos: string, nota?: string) => pedir<unknown>("POST", "/caja/depositos", nota ? { montoCentavos, nota } : { montoCentavos }),
  entregarEfectivo: (paraAdminId: string, montoCentavos: string, nota?: string) =>
    pedir<unknown>("POST", "/caja/traspasos", nota ? { paraAdminId, montoCentavos, nota } : { paraAdminId, montoCentavos }),
  confirmarTraspaso: (id: string) => pedir<unknown>("POST", `/caja/traspasos/${id}/confirmar`),
  rechazarTraspaso: (id: string) => pedir<unknown>("POST", `/caja/traspasos/${id}/rechazar`),
  gastoCaja: (datos: { desde: "CUENTA" | "EFECTIVO"; proveedor?: string; items: ItemParaEnviar[] }) => pedir<unknown>("POST", "/caja/gastos", datos),
  ticketCaja: (desde: "CUENTA" | "EFECTIVO", imagenBase64: string) =>
    pedir<{ estado: "REGISTRADO" | "REVISAR"; motivoRevision: string | null }>("POST", "/caja/tickets", { desde, imagenBase64 }),
  controlarCaja: (declaradoCentavos: string, ajustar: boolean, motivo?: string) =>
    pedir<unknown>("POST", "/caja/controles", motivo ? { declaradoCentavos, ajustar, motivo } : { declaradoCentavos, ajustar }),
  analisis: () => pedir<Analisis>("GET", "/caja/analisis"),
  explicarMes: (mes: string) => pedir<{ explicacion: string }>("POST", "/caja/analisis/explicar", { mes }),
  preguntar: (pregunta: string) => pedir<{ respuesta: string }>("POST", "/caja/analisis/preguntar", { pregunta }),

  paginaResponsable: (token: string) => pedir<PaginaResponsable>("GET", `/publico/cocina/${token}`),
  subirTicketResponsable: (token: string, imagenBase64: string) =>
    pedir<{ estado: "REGISTRADO" | "REVISAR"; motivoRevision: string | null }>("POST", `/publico/cocina/${token}/tickets`, { imagenBase64 }),
};
