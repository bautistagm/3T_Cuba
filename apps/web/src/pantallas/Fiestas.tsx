import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatearDni } from "@3t/shared";
import { api, type DetalleFiesta, type FiestaListada } from "../api";
import { Encabezado, mensajeDe, useAviso } from "../componentes/comunes";
import { BotonEditar, BotonEliminar, EliminarConPlata, EliminarFiesta, OPCIONES_COBRADO, plataDe } from "../componentes/EliminarFiesta";
import { EditarRapido } from "../componentes/EditarRapido";
import { GraficosFiesta } from "../componentes/GraficosFiesta";
import { leerMonto, montoParaEditar, pesos } from "../plata";
import { useAdmin } from "../sesion";

const fechaFiesta = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
const linkDeVenta = (token: string) => `${window.location.origin}/entradas/${token}`;

export function PantallaFiestas() {
  const yo = useAdmin();
  const [fiestas, setFiestas] = useState<FiestaListada[] | null>(null);
  const [creando, setCreando] = useState(false);
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [editando, setEditando] = useState<DetalleFiesta | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      setFiestas((await api.fiestas()).fiestas);
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }, [setAviso]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <>
      <Encabezado volverA="/" volverTexto="3T" titulo="Fiestas" />
      <main className="contenido">
        <Aviso />
        {yo.rol === "DUENO" && !creando && (
          <button type="button" className="boton principal" onClick={() => setCreando(true)}>+ Crear fiesta</button>
        )}
        {creando && (
          <FormFiesta
            alCancelar={() => setCreando(false)}
            alCrear={async (nombre) => {
              setCreando(false);
              setAviso({ tipo: "ok", texto: `${nombre} creada. Entrá para copiar los links de venta.` });
              await cargar();
            }}
          />
        )}
        {fiestas === null && <div className="cargando" aria-label="Cargando" />}
        {fiestas?.length === 0 && !creando && (
          <section className="tarjeta"><p className="ayuda">Todavía no hay fiestas. {yo.rol === "DUENO" ? "Creá la primera." : "Las crea el dueño."}</p></section>
        )}
        {fiestas && fiestas.length > 0 && (
          <section className="tarjeta">
            <ul className="lista">
              {fiestas.map((f) => (
                <li key={f.id}>
                  <Link to={`/fiestas/${f.id}`} className="datos enlace-fila">
                    <strong>{f.nombre}</strong>
                    <span>{fechaFiesta(f.fechaHora)} · {f.vendidas} vendidas{f.pendientes > 0 ? ` · ${f.pendientes} sin pagar` : ""}</span>
                  </Link>
                  <span className={`chip ${f.estado === "A_LA_VENTA" ? "azul" : "gris"}`}>{f.estado === "A_LA_VENTA" ? "A la venta" : "Cerrada"}</span>
                  {yo.rol === "DUENO" && (
                    <>
                      <BotonEditar etiqueta={`Editar ${f.nombre}`} alTocar={() => void api.fiesta(f.id).then(setEditando).catch((e: unknown) => setAviso({ tipo: "error", texto: mensajeDe(e) }))} />
                      <BotonEliminar etiqueta={`Eliminar ${f.nombre}`} alTocar={() => setEliminando(f.id)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {editando && (
          <div className="capa" role="dialog" aria-modal="true">
            <div className="ventana">
              <FormFiesta editar={editando} alCancelar={() => setEditando(null)}
                alCrear={async (nombre) => { setEditando(null); setAviso({ tipo: "ok", texto: `${nombre}: cambios guardados.` }); await cargar(); }} />
            </div>
          </div>
        )}
        {eliminando && (
          <EliminarFiesta fiestaId={eliminando} alCerrar={() => setEliminando(null)}
            alEliminar={(nombre) => { setEliminando(null); setAviso({ tipo: "ok", texto: `${nombre} eliminada.` }); void cargar(); }} />
        )}
      </main>
    </>
  );
}

const partesFecha = (iso: string) => {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}` };
};

/** Crear una fiesta, o editarla si viene `editar` (solo el dueño). */
function FormFiesta(props: { editar?: DetalleFiesta; alCancelar: () => void; alCrear: (nombre: string) => Promise<void> }) {
  const e0 = props.editar;
  const inicio = e0 ? partesFecha(e0.fiesta.fechaHora) : null;
  const [nombre, setNombre] = useState(e0?.fiesta.nombre ?? "");
  const [fecha, setFecha] = useState(inicio?.fecha ?? "");
  const [hora, setHora] = useState(inicio?.hora ?? "23:00");
  const [lugar, setLugar] = useState(e0?.fiesta.lugar ?? "");
  const [tipos, setTipos] = useState<{ id?: string; nombre: string; precio: string }[]>(
    e0 ? e0.tipos.map((t) => ({ id: t.id, nombre: t.nombre, precio: montoParaEditar(t.precioCentavos) })) : [{ nombre: "Mujer", precio: "" }, { nombre: "Hombre", precio: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (tipos.some((t) => !t.nombre.trim())) return setError("Cada tipo de entrada necesita un nombre.");
    const precios = tipos.map((t) => ({ ...t, monto: leerMonto(t.precio) }));
    const malo = precios.find((p) => !p.monto.ok);
    if (malo && !malo.monto.ok) return setError(`Precio ${malo.nombre}: ${malo.monto.error}`);
    setGuardando(true);
    try {
      const datos = {
        nombre,
        fechaHora: new Date(`${fecha}T${hora}:00-03:00`).toISOString(),
        ...(lugar.trim() ? { lugar } : {}),
        tipos: precios.map((p) => ({ ...(p.id ? { id: p.id } : {}), nombre: p.nombre.trim(), precioCentavos: p.monto.ok ? p.monto.centavos : "0" })),
      };
      if (e0) await api.editarFiesta(e0.fiesta.id, datos);
      else await api.crearFiesta(datos);
      await props.alCrear(nombre);
    } catch (e) {
      setError(mensajeDe(e));
      setGuardando(false);
    }
  }

  return (
    <form className="tarjeta" onSubmit={enviar}>
      <h2>{e0 ? "Editar fiesta" : "Nueva fiesta"}</h2>
      <label className="campo">Nombre o motivo<input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Fiesta de fin de año" /></label>
      <div className="fila-campos">
        <label className="campo">Día<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="campo">Hora<input type="time" required value={hora} onChange={(e) => setHora(e.target.value)} /></label>
      </div>
      <label className="campo">Lugar (opcional)<input value={lugar} onChange={(e) => setLugar(e.target.value)} /></label>
      {tipos.map((t, i) => (
        <div className="fila-campos fila-tipo" key={t.id ?? `nuevo-${i}`}>
          {e0 ? (
            <label className="campo">Tipo<input required maxLength={30} value={t.nombre} onChange={(e) => setTipos(tipos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} /></label>
          ) : null}
          <label className="campo">
            {e0 ? "Precio final" : `Precio entrada ${t.nombre}`}
            <input inputMode="decimal" required value={t.precio} placeholder="Ej: 15.000"
              onChange={(e) => setTipos(tipos.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))} />
          </label>
        </div>
      ))}
      {e0 && tipos.length < 6 && (
        <button type="button" className="enlace" onClick={() => setTipos([...tipos, { nombre: "", precio: "" }])}>+ Agregar otro tipo de entrada</button>
      )}
      <p className="ayuda">{e0 ? "Un precio nuevo vale para las compras que se carguen desde ahora; las ya cargadas mantienen el suyo." : "Sin cupo: se venden todas las que se paguen. Cada tipo tiene su link de venta."}</p>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Guardando…" : e0 ? "Guardar cambios" : "Crear fiesta"}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

const ESTADO_ENTRADA: Record<DetalleFiesta["entradas"][number]["estado"], { texto: string; chip: string }> = {
  VALIDA: { texto: "Pagada", chip: "azul" },
  USADA: { texto: "Ingresó", chip: "gris" },
  PENDIENTE_PAGO: { texto: "Sin pagar", chip: "naranja" },
  ANULADA: { texto: "Anulada", chip: "gris" },
};

export function PantallaFiesta() {
  const { id = "" } = useParams();
  const yo = useAdmin();
  const esDueno = yo.rol === "DUENO";
  const [d, setD] = useState<DetalleFiesta | null>(null);
  const [tipoVisto, setTipoVisto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [editandoEntrada, setEditandoEntrada] = useState<DetalleFiesta["entradas"][number] | null>(null);
  const [eliminandoCompra, setEliminandoCompra] = useState<DetalleFiesta["entradas"][number] | null>(null);
  const irA = useNavigate();
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      const r = await api.fiesta(id);
      setD(r);
      setTipoVisto((actual) => actual ?? r.tipos[0]?.id ?? null);
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }, [id, setAviso]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function hacer(accion: () => Promise<unknown>, texto: string) {
    try {
      await accion();
      setAviso({ tipo: "ok", texto });
      await cargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }

  function copiar(texto: string, clave: string) {
    void navigator.clipboard?.writeText(texto).then(() => setCopiado(clave)).catch(() => undefined);
  }

  if (!d) return (<><Encabezado volverA="/fiestas" volverTexto="Fiestas" titulo="Fiesta" /><main className="contenido"><Aviso /><div className="cargando" /></main></>);
  const lista = d.entradas.filter((e) => e.tipoId === tipoVisto);
  const contar = (tipoId: string) => d.entradas.filter((e) => e.tipoId === tipoId && (e.estado === "VALIDA" || e.estado === "USADA")).length;

  return (
    <>
      <Encabezado volverA="/fiestas" volverTexto="Fiestas" titulo={d.fiesta.nombre} />
      <main className="contenido">
        <Aviso />
        <section className="tarjeta">
          {esDueno && (
            <span className="esquina">
              <BotonEditar etiqueta="Editar fiesta" alTocar={() => setEditando(true)} />
              <BotonEliminar etiqueta="Eliminar fiesta" alTocar={() => setEliminando(true)} />
            </span>
          )}
          <p className="ayuda">{fechaFiesta(d.fiesta.fechaHora)}{d.fiesta.lugar ? ` · ${d.fiesta.lugar}` : ""}</p>
          <div className="numeros">
            {d.tipos.map((t) => (
              <span key={t.id}><span className="ayuda">{t.nombre} · {pesos(t.precioVigenteCentavos)}</span><strong>{contar(t.id)} vendidas</strong></span>
            ))}
            <span><span className="ayuda">Recaudado</span><strong>{pesos(d.recaudadoCentavos)}</strong></span>
          </div>
          {d.fiesta.estado === "VENTA_CERRADA" && <p className="aviso error">La venta está cerrada.</p>}
          {esDueno && !d.emailConfigurado && (
            <p className="aviso error">Los emails con las entradas todavía no salen: falta conectar Gmail en Ajustes. Mientras tanto, cada comprador ve sus QR en su página.</p>
          )}
          {esDueno && (
            <button type="button" className="boton secundario chico"
              onClick={() => window.confirm(d.fiesta.estado === "A_LA_VENTA" ? "¿Cerrar la venta? Los links dejan de vender." : "¿Volver a abrir la venta?") &&
                void hacer(() => api.ventaFiesta(d.fiesta.id, d.fiesta.estado !== "A_LA_VENTA"), d.fiesta.estado === "A_LA_VENTA" ? "Venta cerrada." : "Venta abierta.")}>
              {d.fiesta.estado === "A_LA_VENTA" ? "Cerrar la venta" : "Volver a abrir la venta"}
            </button>
          )}
        </section>

        <CobrosPuerta d={d} esDueno={esDueno} hacer={hacer} />

        <GraficosFiesta d={d} />

        {editandoEntrada && (
          <EditarRapido
            titulo="Editar entrada"
            campos={[
              { clave: "nombre", etiqueta: "Nombre y apellido", tipo: "texto", valor: editandoEntrada.nombre, requerido: true, max: 80 },
              { clave: "dni", etiqueta: "DNI", tipo: "texto", valor: editandoEntrada.dni, requerido: true, max: 20 },
            ]}
            ayuda="El QR sigue siendo el mismo."
            alCerrar={() => setEditandoEntrada(null)}
            alGuardar={async (v) => {
              await api.editarEntrada(editandoEntrada.id, { nombre: v.nombre ?? "", dni: v.dni ?? "" });
              setEditandoEntrada(null);
              setAviso({ tipo: "ok", texto: "Entrada editada." });
              await cargar();
            }}
          />
        )}
        {eliminandoCompra && (() => {
          const deLaCompra = d.entradas.filter((x) => x.compraId === eliminandoCompra.compraId);
          const pagada = deLaCompra.some((x) => x.estado === "VALIDA" || x.estado === "USADA");
          const nombres = deLaCompra.map((x) => x.nombre).join(", ");
          return (
            <EliminarConPlata
              titulo={`Eliminar la compra de ${eliminandoCompra.nombre}`}
              montoCentavos={pagada ? eliminandoCompra.compraTotalCentavos : null}
              sinPlata={`Se borra la compra con ${deLaCompra.length === 1 ? "su entrada" : `sus ${deLaCompra.length} entradas (${nombres})`}. No estaba pagada: la caja no cambia.`}
              pregunta={<>Se borra la compra con {deLaCompra.length === 1 ? "su entrada" : `sus ${deLaCompra.length} entradas (${nombres})`}. Se pagaron <strong>{pesos(eliminandoCompra.compraTotalCentavos)}</strong>: ¿qué pasó con esa plata?</>}
              opciones={OPCIONES_COBRADO}
              boton="Eliminar compra"
              alCerrar={() => setEliminandoCompra(null)}
              alConfirmar={async (opcion, nombre) => {
                await api.eliminarCompra(eliminandoCompra.compraId, plataDe(opcion, nombre));
                setEliminandoCompra(null);
                setAviso({ tipo: "ok", texto: "Compra eliminada." });
                await cargar();
              }}
            />
          );
        })()}
        {editando && (
          <div className="capa" role="dialog" aria-modal="true">
            <div className="ventana">
              <FormFiesta editar={d} alCancelar={() => setEditando(false)}
                alCrear={async () => { setEditando(false); setAviso({ tipo: "ok", texto: "Cambios guardados." }); await cargar(); }} />
            </div>
          </div>
        )}
        {eliminando && (
          <EliminarFiesta fiestaId={d.fiesta.id} alCerrar={() => setEliminando(false)} alEliminar={() => void irA("/fiestas")} />
        )}

        {esDueno && <PreciosYTandas tipos={d.tipos} hacer={hacer} />}

        <section className="tarjeta">
          <h2>Links de venta</h2>
          <p className="ayuda">Uno por tipo de entrada: mandá cada uno a quien corresponda.</p>
          {d.tipos.map((t) => {
            const link = linkDeVenta(t.tokenVenta);
            const mensaje = `Entradas ${t.nombre} para ${d.fiesta.nombre} (${fechaFiesta(d.fiesta.fechaHora)}): ${link}`;
            return (
              <div className="fila" key={t.id}>
                <span className="datos"><strong>{t.nombre}</strong><span className="link-corto">{link}</span></span>
                <span className="acciones-cuota">
                  <button type="button" className="boton secundario chico" onClick={() => copiar(link, t.id)}>{copiado === t.id ? "¡Copiado!" : "Copiar"}</button>
                  <a className="boton secundario chico" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                </span>
              </div>
            );
          })}
        </section>

        {esDueno && d.fiesta.tokenPuerta && (() => {
          const link = `${window.location.origin}/puerta/${d.fiesta.tokenPuerta}`;
          const mensaje = `Link de la puerta de ${d.fiesta.nombre}. Abrilo en el celular para escanear los QR (no lo compartas fuera del plantel): ${link}`;
          return (
            <section className="tarjeta">
              <h2>Puerta</h2>
              <p className="ayuda">Mandale este link a los que controlan la entrada. Lo abren en el celular, ponen su nombre y escanean los QR con la cámara. Anda aunque se corte la señal.</p>
              <div className="fila">
                <span className="datos"><strong>Link de la puerta</strong><span className="link-corto">{link}</span></span>
                <span className="acciones-cuota">
                  <button type="button" className="boton secundario chico" onClick={() => copiar(link, "puerta")}>{copiado === "puerta" ? "¡Copiado!" : "Copiar"}</button>
                  <a className="boton secundario chico" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                </span>
              </div>
              <button type="button" className="enlace"
                onClick={() => window.confirm("¿Cambiar el link de la puerta? El link viejo deja de andar y hay que mandar el nuevo.") &&
                  void hacer(() => api.nuevoLinkPuerta(d.fiesta.id), "Link de la puerta cambiado. Mandá el nuevo.")}>
                Cambiar el link (si se filtró)
              </button>
            </section>
          );
        })()}

        <section className="tarjeta">
          <div className="fila-titulo">
            <h2>Lista</h2>
            <a className="boton secundario chico" href={`/api/fiestas/${d.fiesta.id}/lista.csv`} download>Descargar</a>
          </div>
          <div className="segmentado" role="tablist" aria-label="Tipo de entrada">
            {d.tipos.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tipoVisto === t.id} className={tipoVisto === t.id ? "activo" : ""} onClick={() => setTipoVisto(t.id)}>
                {t.nombre} ({contar(t.id)})
              </button>
            ))}
          </div>
          {lista.length === 0 && <p className="ayuda">Todavía no hay entradas de este tipo.</p>}
          <ul className="lista">
            {lista.map((e) => (
              <li key={e.id}>
                <span className="datos">
                  <strong>{e.nombre}</strong>
                  <span>DNI {formatearDni(e.dni)}{e.usadaEn ? ` · entró ${fechaFiesta(e.usadaEn)}${e.usadaPor ? ` (${e.usadaPor})` : ""}` : ""}</span>
                  {(e.estado === "VALIDA" || e.estado === "USADA") && <EstadoEmail email={e.email} estado={d.emails[e.compraId]} />}
                </span>
                <span className="acciones-cuota">
                  <span className={`chip ${ESTADO_ENTRADA[e.estado].chip}`}>{ESTADO_ENTRADA[e.estado].texto}</span>
                  {esDueno && e.estado === "VALIDA" && (
                    <button type="button" className="enlace"
                      onClick={() => {
                        const otro = window.prompt(`Reenviar las entradas de esta compra. ¿A qué email? (dejalo así para mandarlas al mismo)`, e.email);
                        if (otro === null) return;
                        void hacer(() => api.reenviarEntradas(e.compraId, otro.trim() && otro.trim() !== e.email ? otro.trim() : undefined), "Email con las entradas en camino.");
                      }}>
                      reenviar
                    </button>
                  )}
                  {esDueno && (
                    <span className="iconos">
                      {e.estado !== "ANULADA" && <BotonEditar etiqueta={`Editar la entrada de ${e.nombre}`} alTocar={() => setEditandoEntrada(e)} />}
                      <BotonEliminar etiqueta={`Eliminar la compra de ${e.nombre}`} alTocar={() => setEliminandoCompra(e)} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="ayuda">Las entradas pagadas por transferencia se acreditan solas. Si alguien pagó desde otra cuenta, aparece en Pagos → Revisar.</p>
        </section>
      </main>
    </>
  );
}

function EstadoEmail(props: { email: string; estado: DetalleFiesta["emails"][string] | undefined }) {
  const e = props.estado;
  if (!e) return <span>Email: {props.email}</span>;
  if (e.estado === "ENVIADA") return <span>✉️ Enviado a {props.email}</span>;
  if (e.estado === "PENDIENTE") return <span>✉️ Email pendiente a {props.email}{e.error ? ` (reintentando: ${e.error})` : ""}</span>;
  return <span className="texto-error">✉️ No se pudo mandar a {props.email}{e.error ? `: ${e.error}` : ""}</span>;
}

/** Tandas (opcionales): precios por fecha. Manda la primera que no terminó; después, el precio del tipo. */
function PreciosYTandas(props: { tipos: DetalleFiesta["tipos"]; hacer: (accion: () => Promise<unknown>, texto: string) => Promise<void> }) {
  const [agregandoA, setAgregandoA] = useState<string | null>(null);
  const [editandoTanda, setEditandoTanda] = useState<DetalleFiesta["tipos"][number]["tandas"][number] | null>(null);
  const [precio, setPrecio] = useState("");
  const [dia, setDia] = useState("");
  const [horaFin, setHoraFin] = useState("23:59");
  const [error, setError] = useState<string | null>(null);

  async function agregar(evento: FormEvent, tipoId: string) {
    evento.preventDefault();
    setError(null);
    const monto = leerMonto(precio);
    if (!monto.ok) return setError(monto.error);
    await props.hacer(() => api.agregarTanda(tipoId, { precioCentavos: monto.centavos, hasta: new Date(`${dia}T${horaFin}:00-03:00`).toISOString() }), "Tanda agregada.");
    setAgregandoA(null);
    setPrecio("");
    setDia("");
  }

  return (
    <section className="tarjeta">
      <h2>Precios y tandas</h2>
      <p className="ayuda">Opcional. Cada tanda tiene su precio y hasta cuándo vale. Cuando terminan todas, vale el precio final. Quien carga la compra paga el precio de ese momento.</p>
      {editandoTanda && (() => {
        const partes = partesFecha(editandoTanda.hasta);
        return (
          <EditarRapido
            titulo="Editar tanda"
            campos={[
              { clave: "precio", etiqueta: "Precio de la tanda", tipo: "monto", valor: montoParaEditar(editandoTanda.precioCentavos) },
              { clave: "dia", etiqueta: "Vale hasta el día", tipo: "texto", formato: "date", valor: partes.fecha, requerido: true, max: 10 },
              { clave: "hora", etiqueta: "Hora", tipo: "texto", formato: "time", valor: partes.hora, requerido: true, max: 5 },
            ]}
            alCerrar={() => setEditandoTanda(null)}
            alGuardar={async (v) => {
              const hasta = new Date(`${v.dia}T${v.hora}:00-03:00`);
              if (Number.isNaN(hasta.getTime())) throw new Error("La fecha o la hora no son válidas.");
              await api.editarTanda(editandoTanda.id, { precioCentavos: v.precio ?? "0", hasta: hasta.toISOString() });
              setEditandoTanda(null);
              await props.hacer(async () => undefined, "Tanda editada.");
            }}
          />
        );
      })()}
      {props.tipos.map((t) => (
        <div key={t.id} className="bloque-tandas">
          <div className="fila-titulo">
            <strong>{t.nombre} · hoy {pesos(t.precioVigenteCentavos)}</strong>
            {agregandoA !== t.id && (
              <button type="button" className="boton secundario chico" onClick={() => { setAgregandoA(t.id); setError(null); }}>+ Tanda</button>
            )}
          </div>
          <ul className="lista">
            {t.tandas.map((x, i) => (
              <li key={x.id}>
                <span className="datos">
                  <strong>{i + 1}ª tanda · {pesos(x.precioCentavos)}</strong>
                  <span>{x.termino ? "Terminó el" : "Hasta el"} {fechaFiesta(x.hasta)}</span>
                </span>
                {x.termino ? <span className="chip gris">Terminó</span> : (
                  <span className="iconos">
                    <BotonEditar etiqueta={`Editar la ${i + 1}ª tanda`} alTocar={() => setEditandoTanda(x)} />
                    <BotonEliminar etiqueta={`Quitar la ${i + 1}ª tanda`} alTocar={() => window.confirm("¿Quitar esta tanda?") && void props.hacer(() => api.quitarTanda(x.id), "Tanda quitada.")} />
                  </span>
                )}
              </li>
            ))}
            <li>
              <span className="datos"><strong>Precio final · {pesos(t.precioCentavos)}</strong><span>{t.tandas.length ? "Cuando terminan las tandas" : "Sin tandas: precio único"}</span></span>
            </li>
          </ul>
          {agregandoA === t.id && (
            <form onSubmit={(e) => void agregar(e, t.id)}>
              <label className="campo">Precio de la tanda<input inputMode="decimal" required value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="Ej: 10.000" /></label>
              <div className="fila-campos">
                <label className="campo">Vale hasta el día<input type="date" required value={dia} onChange={(e) => setDia(e.target.value)} /></label>
                <label className="campo">Hora<input type="time" required value={horaFin} onChange={(e) => setHoraFin(e.target.value)} /></label>
              </div>
              {error && <p className="aviso error" role="alert">{error}</p>}
              <button className="boton principal" type="submit">Agregar tanda</button>
              <button className="boton secundario" type="button" onClick={() => setAgregandoA(null)}>Cancelar</button>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}

/** Lo que se cobró en efectivo en la puerta, quién lo tiene y "Recibí" para pasarlo al efectivo de un admin. */
function CobrosPuerta(props: { d: DetalleFiesta; esDueno: boolean; hacer: (accion: () => Promise<unknown>, texto: string) => Promise<void> }) {
  const { puerta, tipos } = props.d;
  if (puerta.ventas.length === 0) return null;
  const total = puerta.ventas.reduce((s, v) => s + BigInt(v.montoCentavos), 0n);
  const personas = puerta.ventas.reduce((s, v) => s + v.cantidad, 0);
  const nombreTipo = (id: string) => tipos.find((t) => t.id === id)?.nombre ?? "";
  return (
    <section className="tarjeta">
      <h2>Cobros en la puerta</h2>
      <p className="ayuda">{personas} {personas === 1 ? "persona pagó" : "personas pagaron"} en la puerta: {pesos(total)} en efectivo.</p>
      {puerta.aRendir.length > 0 ? (
        <ul className="lista">
          {puerta.aRendir.map((p) => (
            <li key={p.nombre}>
              <span className="datos"><strong>{p.nombre} tiene {pesos(p.centavos)}</strong><span>{p.cobros} {p.cobros === 1 ? "cobro" : "cobros"} sin entregar</span></span>
              <button type="button" className="boton principal chico"
                onClick={() => window.confirm(`¿${p.nombre} te dio ${pesos(p.centavos)}? Pasa a tu efectivo.`) && void props.hacer(() => api.recibirPlataPuerta(props.d.fiesta.id, p.nombre), `Recibiste ${pesos(p.centavos)} de ${p.nombre}.`)}>
                Recibí
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="aviso ok">Ya se entregó toda la plata de la puerta.</p>
      )}
      <details>
        <summary className="ayuda">Ver cada cobro</summary>
        <ul className="lista">
          {puerta.ventas.map((v) => (
            <li key={v.id}>
              <span className="datos">
                <strong>{v.cantidad} {nombreTipo(v.tipoId)} · {pesos(v.montoCentavos)}</strong>
                <span>{fechaFiesta(v.cobradoEn)} · cobró {v.cobradoPor}{v.estado === "RENDIDA" ? " · entregado" : ""}</span>
              </span>
              {props.esDueno && v.estado === "A_RENDIR" && (
                <BotonEliminar etiqueta="Eliminar este cobro" alTocar={() => window.confirm(`¿Eliminar este cobro de ${pesos(v.montoCentavos)}? Se borra como si no se hubiera cobrado.`) && void props.hacer(() => api.eliminarVentaPuerta(v.id), "Cobro eliminado.")} />
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
