import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useParams } from "react-router";
import { api, type FormaCierre, type Gasto, type Medio, type MovimientoCocina, type ResumenCocina, type Ticket } from "../api";
import { Cargando, Encabezado, mensajeDe, pedirMotivo, SelectorMedio, useAviso } from "../componentes/comunes";
import { EditorItems, NOMBRES_CATEGORIA } from "../componentes/EditorItems";
import { BotonEditar, BotonEliminar, EliminarConPlata } from "../componentes/EliminarFiesta";
import { EditarRapido } from "../componentes/EditarRapido";
import { prepararFoto } from "../fotos";
import { hora, leerMonto, montoParaEditar, pesos } from "../plata";
import { useAdmin } from "../sesion";

const NOMBRE_MOVIMIENTO: Record<MovimientoCocina["tipo"], string> = {
  ADELANTO: "Plata que se les pasó",
  DEVOLUCION: "Devolvieron lo que sobró",
  REINTEGRO: "Se les reintegró lo gastado de más",
  SOBRANTE_NO_DEVUELTO: "Sobrante que no se reclamó",
  EXCESO_NO_REINTEGRADO: "Gasto de más que puso la camada",
};

export function PantallaCocina() {
  const { id = "" } = useParams();
  const ubicacion = useLocation();
  const yo = useAdmin();
  const [r, setR] = useState<ResumenCocina | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>((ubicacion.state as { token?: string } | null)?.token ?? null);
  const [panel, setPanel] = useState<"plata" | "gasto" | "cerrar" | null>(null);
  const [revisando, setRevisando] = useState<Ticket | null>(null);
  const [eliminando, setEliminando] = useState<Gasto | null>(null);
  const [editandoGasto, setEditandoGasto] = useState<Gasto | null>(null);
  const [editandoMov, setEditandoMov] = useState<MovimientoCocina | null>(null);
  const [editandoDatos, setEditandoDatos] = useState(false);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      const [resumen, lista] = await Promise.all([api.cocina(id), api.ticketsDeCocina(id)]);
      setR(resumen);
      setTickets(lista.tickets);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !r) return <main className="contenido"><p className="aviso error" role="alert">{error}</p></main>;
  if (!r) return <Cargando />;

  const abierta = r.cocina.estado === "ABIERTA";
  const saldo = BigInt(r.saldoCentavos);
  const enRevision = tickets.filter((t) => t.estado === "REVISAR");
  const esDueno = yo.rol === "DUENO";

  async function listo(texto: string) {
    setPanel(null);
    setRevisando(null);
    setAviso({ tipo: "ok", texto });
    await cargar();
  }





  return (
    <>
      <Encabezado
        volverA={`/sabados/${r.cocina.sabadoId}`}
        volverTexto="Sábado"
        titulo={`Cocina: camada ${r.cocina.camada}`}
        sub={`Responsable: ${r.cocina.responsableNombre}${abierta ? "" : " · CERRADA"}`}
      />
      <main className="contenido">
        <Aviso />

        <section className="tarjeta" aria-label="Plata de la cocina">
          {esDueno && <span className="esquina"><BotonEditar etiqueta="Editar datos de la cocina" alTocar={() => setEditandoDatos(true)} /></span>}
          <div className="numeros">
            <span><span className="ayuda">Recibió</span><strong>{pesos(r.adelantadoCentavos)}</strong></span>
            <span><span className="ayuda">Gastó</span><strong>{pesos(r.gastadoCentavos)}</strong></span>
            <span>
              <span className="ayuda">{saldo >= 0n ? "Le queda" : "Gastó de más"}</span>
              <strong className={saldo < 0n ? "texto-naranja" : ""}>{pesos(saldo < 0n ? -saldo : saldo)}</strong>
            </span>
          </div>
          {abierta && panel === null && (
            <div className="botonera">
              <button type="button" className="boton principal" onClick={() => setPanel("plata")}>Pasarles plata</button>
              <BotonFoto
                texto="Subir foto de ticket"
                alSubir={async (b64) => {
                  const res = await api.subirTicket(id, b64);
                  await listo(res.estado === "REGISTRADO" ? "Ticket leído y registrado como gasto." : `El ticket quedó para revisar: ${res.motivoRevision ?? ""}`);
                }}
                alFallar={(m) => setAviso({ tipo: "error", texto: m })}
              />
              <button type="button" className="boton secundario" onClick={() => setPanel("gasto")}>Cargar gasto a mano</button>
            </div>
          )}
          {panel === "plata" && <FormPlata cocinaId={id} alListo={() => listo("Plata registrada.")} alCancelar={() => setPanel(null)} />}
          {panel === "gasto" && (
            <EditorItems
              textoBoton="Guardar gasto"
              alGuardar={async (datos) => {
                await api.gastoManual(id, datos);
                await listo("Gasto guardado.");
              }}
              alCancelar={() => setPanel(null)}
            />
          )}
        </section>

        {abierta && <LinkResponsable cocina={r.cocina} token={token} alNuevo={async () => setToken((await api.nuevoLinkCocina(id)).token)} />}

        {enRevision.length > 0 && (
          <section className="tarjeta revisar" aria-labelledby="titulo-revisar">
            <h2 id="titulo-revisar">Tickets para revisar ({enRevision.length})</h2>
            {revisando ? (
              <RevisarTicket ticket={revisando} alListo={listo} alCancelar={() => setRevisando(null)} alError={(m) => setAviso({ tipo: "error", texto: m })} />
            ) : (
              <ul className="lista">
                {enRevision.map((t) => (
                  <li key={t.id}>
                    <span className="datos">
                      <strong>Subido {hora(t.creadoEn)}</strong>
                      <span>{t.motivoRevision}</span>
                    </span>
                    <button type="button" className="boton secundario chico" onClick={() => setRevisando(t)}>Revisar</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="tarjeta" aria-labelledby="titulo-gastos">
          <h2 id="titulo-gastos">Gastos ({r.gastos.filter((g) => g.estado === "CONFIRMADO").length})</h2>
          {r.gastos.length === 0 && <p className="ayuda">Todavía no hay gastos.</p>}
          {r.gastos.map((g) => (
            <details key={g.id} className={`gasto ${g.estado === "ANULADO" ? "anulado" : ""}`}>
              <summary>
                <span className="datos">
                  <strong>{g.proveedor ?? g.descripcion}</strong>
                  <span>{g.origenCarga === "IA" ? "Leído por IA" : "Cargado a mano"}{g.estado === "ANULADO" ? ` · ANULADO: ${g.motivoAnulacion ?? ""}` : ""}</span>
                </span>
                <strong>{pesos(g.totalCentavos)}</strong>
                {esDueno && abierta && g.estado === "CONFIRMADO" && <BotonEditar etiqueta={`Editar el gasto ${g.proveedor ?? g.descripcion}`} alTocar={() => setEditandoGasto(g)} />}
                {esDueno && (
                  <BotonEliminar etiqueta={`Eliminar el gasto ${g.proveedor ?? g.descripcion}`} alTocar={() => {
                    if (!abierta) {
                      setAviso({ tipo: "error", texto: "Esta cocina ya se cerró y rindió: un gasto suelto no se elimina. Para cambiarla, vas a poder eliminar el sábado entero." });
                      return;
                    }
                    setEliminando(g);
                  }} />
                )}
              </summary>
              <ul className="items">
                {g.items.map((i, k) => (
                  <li key={k}>
                    <span>{i.descripcion}{i.cantidad ? ` · ${i.cantidad}` : ""} <span className="ayuda">({NOMBRES_CATEGORIA[i.categoria].split(" ")[0]})</span></span>
                    <span>{pesos(i.subtotalCentavos)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>

        {editandoGasto && (
          <div className="capa" role="dialog" aria-modal="true" aria-label="Editar gasto">
            <div className="tarjeta ventana">
              <h2>Editar gasto</h2>
              <EditorItems
                proveedorInicial={editandoGasto.proveedor ?? ""}
                iniciales={editandoGasto.items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad ?? "", categoria: i.categoria, importe: montoParaEditar(i.subtotalCentavos) }))}
                textoBoton="Guardar cambios"
                alCancelar={() => setEditandoGasto(null)}
                alGuardar={async (datos) => {
                  await api.editarGasto(editandoGasto.id, { ...(datos.proveedor ? { proveedor: datos.proveedor } : {}), items: datos.items });
                  setEditandoGasto(null);
                  await listo("Gasto editado.");
                }}
              />
            </div>
          </div>
        )}
        {eliminando && (
          <EliminarConPlata
            titulo={`Eliminar el gasto «${eliminando.proveedor ?? eliminando.descripcion}»`}
            montoCentavos={eliminando.estado === "ANULADO" ? null : eliminando.totalCentavos}
            sinPlata="Este gasto ya estaba anulado: se borra y la caja no cambia."
            pregunta={<>Este gasto sacó <strong>{pesos(eliminando.totalCentavos)}</strong> de la caja. Para que cierre, decí qué pasó con esa plata:</>}
            opciones={[
              { valor: "VUELVE", titulo: "No se gastó o la devolvieron", ayuda: "La plata vuelve a donde estaba." },
              { valor: "SE_GASTO", titulo: "Se gastó igual", ayuda: "Queda como otro gasto, con el nombre que le pongas.", pideNombre: { etiqueta: "¿En qué se gastó?", ejemplo: "Ej: Prueba de la app" } },
            ]}
            boton="Eliminar gasto"
            alCerrar={() => setEliminando(null)}
            alConfirmar={async (opcion, nombre) => {
              await api.eliminarGasto(eliminando.id, opcion === null ? null : opcion === "VUELVE" ? { destino: "VUELVE" } : { destino: "SE_GASTO", concepto: nombre });
              setEliminando(null);
              await listo("Gasto eliminado.");
            }}
          />
        )}

        {editandoMov && (
          <EditarRapido
            titulo={`Corregir: ${NOMBRE_MOVIMIENTO[editandoMov.tipo]}`}
            campos={[{ clave: "monto", etiqueta: "Monto", tipo: "monto", valor: montoParaEditar(editandoMov.montoCentavos) }]}
            alCerrar={() => setEditandoMov(null)}
            alGuardar={async (v) => {
              await api.editarMovimientoCocina(editandoMov.id, v.monto ?? "0");
              setEditandoMov(null);
              await listo("Monto corregido.");
            }}
          />
        )}
        {editandoDatos && (
          <EditarRapido
            titulo="Datos de la cocina"
            campos={[
              { clave: "camada", etiqueta: "Camada", tipo: "texto", valor: r.cocina.camada, requerido: true, max: 60 },
              { clave: "responsable", etiqueta: "Responsable", tipo: "texto", valor: r.cocina.responsableNombre, requerido: true, max: 80 },
              { clave: "telefono", etiqueta: "Teléfono (opcional)", tipo: "texto", valor: r.cocina.responsableTelefono ?? "", max: 30 },
            ]}
            alCerrar={() => setEditandoDatos(false)}
            alGuardar={async (v) => {
              await api.editarCocina(r.cocina.id, { camada: v.camada ?? "", responsableNombre: v.responsable ?? "", ...(v.telefono ? { responsableTelefono: v.telefono } : {}) });
              setEditandoDatos(false);
              await listo("Datos de la cocina guardados.");
            }}
          />
        )}

        {r.movimientos.length > 0 && (
          <section className="tarjeta" aria-labelledby="titulo-movimientos">
            <h2 id="titulo-movimientos">Plata entre el plantel y la camada</h2>
            <ul className="lista">
              {r.movimientos.map((m) => (
                <li key={m.id} className={m.estado === "ANULADO" ? "anulado" : ""}>
                  <span className="datos">
                    <strong>{NOMBRE_MOVIMIENTO[m.tipo]}</strong>
                    <span>{m.medio ? (m.medio === "EFECTIVO" ? "Efectivo" : "Transferencia") : ""}{m.nota ? ` · ${m.nota}` : ""}{m.estado === "ANULADO" ? " · ANULADO" : ""}</span>
                  </span>
                  <span className="lado">
                    <strong>{pesos(m.montoCentavos)}</strong>
                    {esDueno && abierta && (
                      <span className="iconos">
                        {m.estado === "CONFIRMADO" && <BotonEditar etiqueta={`Editar ${NOMBRE_MOVIMIENTO[m.tipo]}`} alTocar={() => setEditandoMov(m)} />}
                        <BotonEliminar etiqueta={`Eliminar ${NOMBRE_MOVIMIENTO[m.tipo]}`} alTocar={() => {
                          if (!window.confirm(`¿Eliminar este movimiento de ${pesos(m.montoCentavos)}? Es como si no se hubiera hecho: la plata vuelve a donde estaba.`)) return;
                          void api.eliminarMovimientoCocina(m.id).then(() => listo("Movimiento eliminado.")).catch((e: unknown) => setAviso({ tipo: "error", texto: mensajeDe(e) }));
                        }} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {abierta && panel === null && (
          <button type="button" className="boton secundario" onClick={() => setPanel("cerrar")}>Cerrar la cocina y rendir</button>
        )}
        {panel === "cerrar" && <FormCierre cocinaId={id} saldo={saldo} esDueno={esDueno} alListo={() => listo("Cocina cerrada.")} alCancelar={() => setPanel(null)} />}
      </main>
    </>
  );
}

function BotonFoto(props: {
  texto: string;
  alSubir: (b64: string) => Promise<void>;
  alFallar: (m: string) => void;
  claro?: boolean;
  /** false para elegir de la galería (capturas de pantalla, como un comprobante). */
  camara?: boolean;
  textoSubiendo?: string;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  async function elegido(archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(true);
    try {
      await props.alSubir(await prepararFoto(archivo));
    } catch (e) {
      props.alFallar(mensajeDe(e));
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  }
  return (
    <>
      <input ref={entrada} type="file" accept="image/*" {...(props.camara === false ? {} : { capture: "environment" as const })} className="oculto" tabIndex={-1}
        onChange={(e) => void elegido(e.target.files?.[0])} />
      <button type="button" className="boton principal" disabled={subiendo} onClick={() => entrada.current?.click()}>
        {subiendo ? (props.textoSubiendo ?? "Leyendo el ticket… (puede tardar unos segundos)") : props.texto}
      </button>
    </>
  );
}
export { BotonFoto };

function FormPlata(props: { cocinaId: string; alListo: () => Promise<void>; alCancelar: () => void }) {
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<Medio>("TRANSFERENCIA");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    const m = leerMonto(monto);
    if (!m.ok) return setError(m.error);
    try {
      await api.adelantar(props.cocinaId, { montoCentavos: m.centavos, medio, ...(nota.trim() ? { nota: nota.trim() } : {}) });
      await props.alListo();
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <form onSubmit={enviar} className="panel">
      <label className="campo">
        ¿Cuánto les pasaron?
        <input inputMode="decimal" autoFocus required value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej: 300.000" />
      </label>
      <SelectorMedio valor={medio} alCambiar={setMedio} />
      <label className="campo">
        Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit">Registrar</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

function LinkResponsable(props: { cocina: ResumenCocina["cocina"]; token: string | null; alNuevo: () => Promise<void> }) {
  const [copiado, setCopiado] = useState(false);
  const link = props.token ? `${window.location.origin}/cocina/${props.token}` : null;
  const telefono = props.cocina.responsableTelefono?.replace(/\D/g, "");
  const mensaje = link
    ? `Hola ${props.cocina.responsableNombre}! Por este link podés sacarle foto a cada ticket de lo que compren para la cocina del sábado: ${link}`
    : "";
  return (
    <section className="tarjeta" aria-labelledby="titulo-link">
      <h2 id="titulo-link">Link para el responsable</h2>
      {!link ? (
        <>
          <p className="ayuda">Con este link {props.cocina.responsableNombre} sube las fotos de los tickets, sin bajarse nada. Si generás uno nuevo, el anterior deja de andar.</p>
          <button type="button" className="boton secundario" onClick={() => void props.alNuevo()}>Generar link</button>
        </>
      ) : (
        <>
          <p className="link-texto">{link}</p>
          <div className="botonera">
            <a className="boton principal" href={`https://wa.me/${telefono ?? ""}?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">
              Mandar por WhatsApp
            </a>
            <button type="button" className="boton secundario" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopiado(true))}>
              {copiado ? "¡Copiado!" : "Copiar link"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function RevisarTicket(props: { ticket: Ticket; alListo: (t: string) => Promise<void>; alCancelar: () => void; alError: (m: string) => void }) {
  const lectura = props.ticket.lecturaIa;
  const iniciales = (lectura?.items ?? []).map((i) => ({
    descripcion: i.descripcion,
    cantidad: i.cantidad ?? "",
    categoria: i.categoria,
    importe: (BigInt(i.importe_centavos) / 100n).toString() + (BigInt(i.importe_centavos) % 100n ? "," + (BigInt(i.importe_centavos) % 100n).toString().padStart(2, "0") : ""),
  }));
  async function descartar() {
    const motivo = pedirMotivo("este ticket (no se carga como gasto)");
    if (!motivo) return;
    try {
      await api.descartarTicket(props.ticket.id, motivo);
      await props.alListo("Ticket descartado.");
    } catch (e) {
      props.alError(mensajeDe(e));
    }
  }
  return (
    <div className="panel">
      <p className="aviso error">{props.ticket.motivoRevision}</p>
      <a href={`/api/tickets/${props.ticket.id}/foto`} target="_blank" rel="noreferrer">
        <img className="foto-ticket" src={`/api/tickets/${props.ticket.id}/foto`} alt="Foto del ticket" />
      </a>
      <p className="ayuda">Corregí lo que haga falta mirando la foto y confirmá.</p>
      <EditorItems
        iniciales={iniciales}
        proveedorInicial={lectura?.proveedor ?? ""}
        textoBoton="Confirmar gasto"
        alGuardar={async (datos) => {
          await api.resolverTicket(props.ticket.id, datos);
          await props.alListo("Gasto confirmado.");
        }}
        alCancelar={props.alCancelar}
      />
      <button type="button" className="boton peligro" onClick={() => void descartar()}>No es un gasto: descartar</button>
    </div>
  );
}

function FormCierre(props: { cocinaId: string; saldo: bigint; esDueno: boolean; alListo: () => Promise<void>; alCancelar: () => void }) {
  const monto = pesos(props.saldo < 0n ? -props.saldo : props.saldo);
  const opciones: { forma: FormaCierre; texto: string; soloDueno?: boolean }[] =
    props.saldo > 0n
      ? [
          { forma: "DEVOLUCION_TRANSFERENCIA", texto: `Devolvieron ${monto} por transferencia` },
          { forma: "DEVOLUCION_EFECTIVO", texto: `Me devolvieron ${monto} en efectivo` },
          { forma: "SOBRANTE_NO_DEVUELTO", texto: `No se reclaman los ${monto}`, soloDueno: true },
        ]
      : props.saldo < 0n
        ? [
            { forma: "REINTEGRO_TRANSFERENCIA", texto: `Se les reintegran ${monto} por transferencia` },
            { forma: "REINTEGRO_EFECTIVO", texto: `Les doy ${monto} en efectivo` },
            { forma: "EXCESO_NO_REINTEGRADO", texto: `No se reintegran los ${monto} (los pone la camada)`, soloDueno: true },
          ]
        : [{ forma: "SIN_DIFERENCIA", texto: "Gastaron justo lo recibido: cerrar" }];
  const [elegida, setElegida] = useState<FormaCierre | null>(opciones.length === 1 ? (opciones[0]?.forma ?? null) : null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pideMotivo = elegida === "SOBRANTE_NO_DEVUELTO" || elegida === "EXCESO_NO_REINTEGRADO";

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!elegida) return setError("Elegí cómo se rinde.");
    try {
      await api.cerrarCocina(props.cocinaId, elegida, pideMotivo ? motivo : undefined);
      await props.alListo();
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <form onSubmit={enviar} className="tarjeta">
      <h2>Cerrar y rendir</h2>
      <p className="ayuda">
        {props.saldo > 0n ? `Les sobraron ${monto}.` : props.saldo < 0n ? `Gastaron ${monto} de más.` : "No hay diferencia."} Una vez cerrada, no se pueden cargar más tickets.
      </p>
      <fieldset className="opciones">
        <legend className="oculto">Cómo se rinde</legend>
        {opciones.filter((o) => !o.soloDueno || props.esDueno).map((o) => (
          <label key={o.forma} className="opcion">
            <input type="radio" name="forma" checked={elegida === o.forma} onChange={() => setElegida(o.forma)} />
            {o.texto}
          </label>
        ))}
      </fieldset>
      {pideMotivo && (
        <label className="campo">
          Motivo
          <input required minLength={5} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
      )}
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit">Cerrar la cocina</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}
