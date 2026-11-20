/** Error de una regla del negocio, con un mensaje pensado para mostrarle a la persona. */
export class ErrorNegocio extends Error {
  constructor(
    readonly estado: 400 | 403 | 404 | 409 | 422,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorNegocio";
  }
}

export const noExiste = (que: string) => new ErrorNegocio(404, "NO_EXISTE", `${que} no existe.`);
export const soloDueno = (que: string) => new ErrorNegocio(403, "SOLO_DUENO", `Solo el dueño puede ${que}.`);
