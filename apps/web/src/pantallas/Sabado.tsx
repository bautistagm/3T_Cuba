import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Cobro, type DetalleSabado, type FilaSabado, type Medio } from "../api";
import { Cargando, Encabezado, mensajeDe, pedirMotivo, SelectorMedio, useAviso } from "../componentes/comunes";
import { fechaLarga, hora, leerMonto, pesos } from "../plata";
import { useAdmin } from "../sesion";

export function PantallaSabado() {
  const { id } = useParams();
  const yo = useAdmin();
  const navegar = useNavigate();
  const [detalle, setDetalle] = useState<DetalleSabado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [verOtros, setVerOtros] = useState(false);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      setDetalle(id ? await api.sabado(id) : await api.sabadoActual());
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, [id]);

  useEffect(() => {
    setDetalle(null);
    void cargar();
  }, [cargar]);

  if (error && !detalle) {
    return (
      <>
        <Encabezado volverA="/" volverTexto="3T" titulo="Sábados" />
        <main className="contenido"><p className="aviso error" role="alert">{error}</p></main>
      </>
    );
  }
  if (!detalle) return <Cargando />;
  const { sabado } = detalle;

  async function cambiarLocal(esLocal: boolean) {
    const anterior = detalle;
    if (anterior) setDetalle({ ...anterior, sabado: { ...anterior.sabado, esLocal } });
    try {
      setDetalle(await api.marcarLocal(sabado.id, esLocal));
    } catch (e) {
      setDetalle(anterior);
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }

  async function anular(cobro: Cobro) {
    const motivo = pedirMotivo("este cobro");
    if (!motivo) return;
    try {
      await api.anularPago(cobro.id, motivo);
      setAviso({ tipo: "ok", texto: "Cobro anulado." });
      await cargar();
    } catch (e) {
      setAviso({ tipo: "error", texto: mensajeDe(e) });
    }
  }

  return (
    <>
      <Encabezado volverA="/" volverTexto="3T" titulo={`Sábado ${fechaLarga(sabado.fecha).replace(/^sábado,?\s*/i, "")}`} />
      <main className="contenido">
        <Aviso />

        <label className="interruptor tarjeta">
          <span>
            <strong>Jugamos de local</strong>
            <span className="ayuda">Si es de local, cocina una camada.</span>
          </span>
          <input type="checkbox" checked={sabado.esLocal} onChange={(e) => void cambiarLocal(e.target.checked)} />
        </label>

        <section className="tarjeta" aria-labelledby="titulo-invitados">
          <div className="fila-titulo">
            <h2 id="titulo-invitados">Invitados</h2>
            <span className="ayuda">{detalle.invitados} · {pesos(detalle.cobradoCentavos)}</span>
          </div>
          <PrecioInvitado precio={detalle.precioInvitadoCentavos} esDueno={yo.rol === "DUENO"} alCambiar={cargar} />
          {detalle.precioInvitadoCentavos !== null && !cobrando && (
            <button type="button" className="boton principal grande" onClick={() => setCobrando(true)}>
              Cobrar invitado · {pesos(detalle.precioInvitadoCentavos)}
            </button>
          )}
          {cobrando && (
            <FormCobro
              sabadoId={sabado.id}
              precio={detalle.precioInvitadoCentavos}
              alTerminar={async (ok) => {
                setCobrando(false);
                if (ok) {
                  setAviso({ tipo: "ok", texto: "Cobro registrado." });
                  await cargar();
                }
              }}
            />
          )}
          {detalle.cobros.length > 0 && (
            <ul className="lista">
              {detalle.cobros.map((c) => (
                <li key={c.id} className={c.estado === "ANULADO" ? "anulado" : ""}>
                  <span className="datos">
                    <strong>{[c.nombrePagador, c.camadaPagador ? `camada ${c.camadaPagador}` : null].filter(Boolean).join(" · ") || "Invitado"}</strong>
                    <span>
                      {c.medio === "EFECTIVO" ? "Efectivo" : "Transferencia"} · {hora(c.fecha)}
                      {c.registradoPorAdminId ? ` · cobró ${detalle.nombresAdmins[c.registradoPorAdminId] ?? "?"}` : ""}
                      {c.estado === "ANULADO" ? ` · ANULADO: ${c.motivoAnulacion ?? ""}` : ""}
                    </span>
                  </span>
                  <span className="lado">
                    <strong>{pesos(c.montoCentavos)}</strong>
                    {yo.rol === "DUENO" && c.estado === "CONFIRMADO" && (
                      <button type="button" className="enlace" onClick={() => void anular(c)}>Anular</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {sabado.esLocal && <TarjetaCocina detalle={detalle} alCrear={(cocinaId, token) => navegar(`/cocinas/${cocinaId}`, { state: { token } })} />}

        <button type="button" className="boton secundario" onClick={() => setVerOtros((v) => !v)}>
          {verOtros ? "Ocultar otros sábados" : "Ver otros sábados"}
        </button>
        {verOtros && <OtrosSabados actual={sabado.id} />}
      </main>
    </>
  );
}

function PrecioInvitado(props: { precio: string | null; esDueno: boolean; alCambiar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    const m = leerMonto(texto);
    if (!m.ok) return setError(m.error);
    try {
      await api.fijarPrecioInvitado(m.centavos);
      setEditando(false);
      await props.alCambiar();
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  if (editando) {
    return (
      <form onSubmit={guardar}>
        <label className="campo">
          Precio por invitado
          <input inputMode="decimal" autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej: 15.000" />
        </label>
        {error && <p className="aviso error" role="alert">{error}</p>}
        <button className="boton principal" type="submit">Guardar precio</button>
        <button className="boton secundario" type="button" onClick={() => setEditando(false)}>Cancelar</button>
      </form>
    );
  }
  if (props.precio === null) {
    return props.esDueno ? (
      <button type="button" className="boton principal" onClick={() => setEditando(true)}>Fijar el precio de los invitados</button>
    ) : (
      <p className="aviso error">Todavía no hay precio para los invitados. Lo fija el dueño.</p>
    );
  }
  return props.esDueno ? (
    <button type="button" className="enlace" onClick={() => { setTexto(""); setEditando(true); }}>
      Cambiar el precio ({pesos(props.precio)})
    </button>
  ) : null;
}

function FormCobro(props: { sabadoId: string; precio: string | null; alTerminar: (ok: boolean) => Promise<void> }) {
  const [medio, setMedio] = useState<Medio>("EFECTIVO");
  const [nombre, setNombre] = useState("");
  const [camada, setCamada] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    try {
      await api.cobrarInvitado(props.sabadoId, {
        medio,
        ...(nombre.trim() ? { nombre: nombre.trim() } : {}),
        ...(camada.trim() ? { camada: camada.trim() } : {}),
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      await props.alTerminar(true);
    } catch (e) {
      setError(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="panel">
      <SelectorMedio valor={medio} alCambiar={setMedio} />
      <div className="dos-columnas">
        <label className="campo">
          Nombre (opcional)
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
        </label>
        <label className="campo">
          Camada (opcional)
          <input value={camada} onChange={(e) => setCamada(e.target.value)} inputMode="numeric" autoComplete="off" />
        </label>
      </div>
      <label className="campo">
        Nota (opcional)
        <input value={nota} onChange={(e) => setNota(e.target.value)} autoComplete="off" />
      </label>
      <p className="ayuda">
        {medio === "EFECTIVO" ? "La plata queda a tu cargo hasta que la rindas." : "Confirmá que la transferencia llegó al alias."}
      </p>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={enviando}>
        {enviando ? "Guardando…" : `Confirmar cobro de ${pesos(props.precio)}`}
      </button>
      <button className="boton secundario" type="button" onClick={() => void props.alTerminar(false)}>Cancelar</button>
    </form>
  );
}

function TarjetaCocina(props: { detalle: DetalleSabado; alCrear: (cocinaId: string, token: string) => void }) {
  const { cocina } = props.detalle;
  const [creando, setCreando] = useState(false);
  const [datos, setDatos] = useState({ camada: "", responsableNombre: "", responsableTelefono: "" });
  const [error, setError] = useState<string | null>(null);

  if (cocina) {
    const saldo = BigInt(cocina.saldoCentavos);
    return (
      <Link to={`/cocinas/${cocina.cocina.id}`} className="tarjeta oscura">
        <span className="ayuda-clara">Cocina {cocina.cocina.estado === "CERRADA" ? "· cerrada" : ""}</span>
        <strong className="grande">Camada {cocina.cocina.camada}</strong>
        <span className="ayuda-clara">
          Recibió {pesos(cocina.adelantadoCentavos)} · gastó {pesos(cocina.gastadoCentavos)}
          {cocina.cocina.estado === "ABIERTA" ? ` · ${saldo >= 0n ? "le quedan" : "gastó de más"} ${pesos(saldo < 0n ? -saldo : saldo)}` : ""}
        </span>
      </Link>
    );
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    try {
      const r = await api.crearCocina(props.detalle.sabado.id, {
        camada: datos.camada,
        responsableNombre: datos.responsableNombre,
        ...(datos.responsableTelefono.trim() ? { responsableTelefono: datos.responsableTelefono.trim() } : {}),
      });
      props.alCrear(r.cocina.id, r.token);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  return (
    <section className="tarjeta" aria-labelledby="titulo-cocina">
      <h2 id="titulo-cocina">Cocina</h2>
      {!creando ? (
        <button type="button" className="boton secundario" onClick={() => setCreando(true)}>Asignar la camada que cocina</button>
      ) : (
        <form onSubmit={crear}>
          <label className="campo">
            Camada
            <input required value={datos.camada} onChange={(e) => setDatos({ ...datos, camada: e.target.value })} inputMode="numeric" />
          </label>
          <label className="campo">
            Responsable
            <input required value={datos.responsableNombre} onChange={(e) => setDatos({ ...datos, responsableNombre: e.target.value })} />
          </label>
          <label className="campo">
            WhatsApp del responsable (opcional)
            <input type="tel" value={datos.responsableTelefono} onChange={(e) => setDatos({ ...datos, responsableTelefono: e.target.value })} />
          </label>
          {error && <p className="aviso error" role="alert">{error}</p>}
          <button className="boton principal" type="submit">Asignar</button>
          <button className="boton secundario" type="button" onClick={() => setCreando(false)}>Cancelar</button>
        </form>
      )}
    </section>
  );
}

function OtrosSabados({ actual }: { actual: string }) {
  const [lista, setLista] = useState<FilaSabado[] | null>(null);
  useEffect(() => {
    void api.listarSabados().then((r) => setLista(r.sabados)).catch(() => setLista([]));
  }, []);
  if (!lista) return <div className="cargando" aria-label="Cargando" />;
  return (
    <section className="tarjeta">
      <ul className="lista">
        {lista.filter((s) => s.id !== actual).map((s) => (
          <li key={s.id}>
            <Link to={`/sabados/${s.id}`} className="datos">
              <strong>{fechaLarga(s.fecha)}</strong>
              <span>{s.esLocal ? "De local · " : ""}{s.invitados} invitados · {pesos(s.cobradoCentavos)}</span>
            </Link>
          </li>
        ))}
        {lista.length <= 1 && <li className="ayuda">Todavía no hay otros sábados.</li>}
      </ul>
    </section>
  );
}
