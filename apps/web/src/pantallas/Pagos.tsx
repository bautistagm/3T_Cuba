import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatearDni } from "@3t/shared";
import { api, type DatosJugador, type Jugador, type VistaImportacion } from "../api";
import { Encabezado, mensajeDe, useAviso } from "../componentes/comunes";
import { useAdmin } from "../sesion";
import { CuotasDelJugador, PanelCuotas } from "./Cuotas";
import { PanelRevisar } from "./Revisar";

export function PantallaPagos() {
  const [pestana, setPestana] = useState<"jugadores" | "cuotas" | "revisar">("jugadores");
  const [paraRevisar, setParaRevisar] = useState(0);
  const contar = useCallback(() => {
    api.estadoCuenta().then((e) => setParaRevisar(e.paraRevisar)).catch(() => undefined);
  }, []);
  // Al abrir Pagos, la app lee la cuenta (si no se leyó hace poco) y actualiza lo que hay para revisar.
  useEffect(() => {
    api.leerCuentaAhora().catch(() => undefined).finally(contar);
  }, [contar]);
  return (
    <>
      <Encabezado volverA="/" volverTexto="3T" titulo="Pagos" />
      <div className="contenido" style={{ paddingBottom: 0 }}>
        <div className="segmentado tres" role="tablist" aria-label="Secciones de pagos">
          <button type="button" role="tab" aria-selected={pestana === "jugadores"} className={pestana === "jugadores" ? "activo" : ""} onClick={() => setPestana("jugadores")}>
            Jugadores
          </button>
          <button type="button" role="tab" aria-selected={pestana === "cuotas"} className={pestana === "cuotas" ? "activo" : ""} onClick={() => setPestana("cuotas")}>
            Cuotas
          </button>
          <button type="button" role="tab" aria-selected={pestana === "revisar"} className={pestana === "revisar" ? "activo" : ""} onClick={() => setPestana("revisar")}>
            Revisar{paraRevisar > 0 ? ` (${paraRevisar})` : ""}
          </button>
        </div>
      </div>
      {pestana === "jugadores" && <PanelJugadores />}
      {pestana === "cuotas" && <PanelCuotas />}
      {pestana === "revisar" && <PanelRevisar alCambiar={contar} />}
    </>
  );
}

const nombreCompleto = (j: Pick<Jugador, "nombre" | "apellido">) => `${j.apellido}, ${j.nombre}`;

function PanelJugadores() {
  const yo = useAdmin();
  const esDueno = yo.rol === "DUENO";
  const [estado, setEstado] = useState<"ACTIVO" | "BAJA">("ACTIVO");
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Jugador[] | null>(null);
  const [totales, setTotales] = useState({ activos: 0, baja: 0 });
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"alta" | "importar" | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      const r = await api.jugadores({ estado, buscar });
      setLista(r.jugadores);
      setTotales(r.totales);
      setError(null);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, [estado, buscar]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), buscar ? 250 : 0);
    return () => clearTimeout(t);
  }, [cargar, buscar]);

  async function listo(texto: string) {
    setPanel(null);
    setAbierto(null);
    setAviso({ tipo: "ok", texto });
    await cargar();
  }

  return (
    <main className="contenido">
      <Aviso />
      <section className="tarjeta" aria-labelledby="titulo-jugadores">
        <div className="fila-titulo">
          <h2 id="titulo-jugadores">Jugadores</h2>
          <span className="ayuda">{totales.activos} {totales.activos === 1 ? "activo" : "activos"}{totales.baja > 0 ? ` · ${totales.baja} de baja` : ""}</span>
        </div>
        {panel === null && (
          <div className="botonera">
            <button type="button" className="boton principal" onClick={() => setPanel("alta")}>+ Agregar jugador</button>
            {esDueno && (
              <button type="button" className="boton secundario" onClick={() => setPanel("importar")}>Importar del Formulario de Google</button>
            )}
          </div>
        )}
        {panel === "alta" && <FormJugador textoBoton="Agregar" alGuardar={async (d) => { await api.crearJugador(d); await listo(`${d.nombre} ${d.apellido} quedó cargado.`); }} alCancelar={() => setPanel(null)} />}
        {panel === "importar" && <Importar alListo={listo} alCancelar={() => setPanel(null)} />}
      </section>

      <section className="tarjeta" aria-label="Lista de jugadores">
        <input type="search" placeholder="Buscar por nombre, camada o DNI" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar jugador" />
        {totales.baja > 0 && (
          <div className="segmentado" role="radiogroup" aria-label="Qué jugadores ver">
            {(["ACTIVO", "BAJA"] as const).map((e) => (
              <button key={e} type="button" role="radio" aria-checked={estado === e} className={estado === e ? "activo" : ""} onClick={() => setEstado(e)}>
                {e === "ACTIVO" ? "Activos" : "De baja"}
              </button>
            ))}
          </div>
        )}
        {error && <p className="aviso error" role="alert">{error}</p>}
        {lista === null && !error && <div className="cargando" aria-label="Cargando" />}
        {lista?.length === 0 && (
          <p className="ayuda">
            {buscar ? "No hay jugadores que coincidan." : estado === "ACTIVO" ? "Todavía no hay jugadores cargados." : "No hay jugadores de baja."}
          </p>
        )}
        {lista && lista.length > 0 && (
          <ul className="lista lista-jugadores">
            {lista.map((j) => (
              <li key={j.id}>
                <button type="button" className="fila-jugador" aria-expanded={abierto === j.id} onClick={() => setAbierto(abierto === j.id ? null : j.id)}>
                  <span className="datos">
                    <strong>{nombreCompleto(j)}</strong>
                    <span>{[j.camada ? `Camada ${j.camada}` : null, `DNI ${formatearDni(j.dni)}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span aria-hidden="true" className="flecha">{abierto === j.id ? "▴" : "▾"}</span>
                </button>
                {abierto === j.id && (
                  <DetalleJugador jugador={j} esDueno={esDueno} alListo={listo}
                    alAvisar={(texto) => setAviso({ tipo: "ok", texto })}
                    alFallar={(m) => setAviso({ tipo: "error", texto: m })} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function FormJugador(props: { inicial?: Jugador; dniEditable?: boolean; textoBoton: string; alGuardar: (d: DatosJugador) => Promise<void>; alCancelar: () => void }) {
  const i = props.inicial;
  const [d, setD] = useState<DatosJugador>({
    nombre: i?.nombre ?? "",
    apellido: i?.apellido ?? "",
    dni: i ? formatearDni(i.dni) : "",
    telefono: i?.telefono ?? "",
    email: i?.email ?? "",
    camada: i?.camada ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = (k: keyof DatosJugador) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }) });

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await props.alGuardar(d);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <form onSubmit={enviar} className="panel">
      <label className="campo">Nombre<input required autoComplete="off" {...campo("nombre")} /></label>
      <label className="campo">Apellido<input required autoComplete="off" {...campo("apellido")} /></label>
      <label className="campo">
        DNI
        <input required inputMode="numeric" autoComplete="off" disabled={props.dniEditable === false} {...campo("dni")} placeholder="Ej: 44.123.456" />
        {props.dniEditable === false && <span className="ayuda">Solo el dueño puede cambiar el DNI.</span>}
      </label>
      <label className="campo">Celular (WhatsApp, opcional)<input inputMode="tel" autoComplete="off" {...campo("telefono")} placeholder="Ej: 11 5555-1234" /></label>
      <label className="campo">Email (opcional)<input type="email" autoComplete="off" {...campo("email")} /></label>
      <label className="campo">Camada (opcional)<input autoComplete="off" {...campo("camada")} placeholder="Ej: 2005" /></label>
      {error && <p className="aviso error" role="alert">{error}</p>}
      <button className="boton principal" type="submit" disabled={guardando}>{guardando ? "Guardando…" : props.textoBoton}</button>
      <button className="boton secundario" type="button" onClick={props.alCancelar}>Cancelar</button>
    </form>
  );
}

function DetalleJugador(props: {
  jugador: Jugador;
  esDueno: boolean;
  alListo: (texto: string) => Promise<void>;
  alAvisar: (texto: string) => void;
  alFallar: (m: string) => void;
}) {
  const j = props.jugador;
  const [editando, setEditando] = useState(false);
  const nombre = `${j.nombre} ${j.apellido}`;

  async function hacer(accion: () => Promise<unknown>, texto: string) {
    try {
      await accion();
      await props.alListo(texto);
    } catch (e) {
      props.alFallar(mensajeDe(e));
    }
  }

  if (editando) {
    return (
      <FormJugador
        inicial={j}
        dniEditable={props.esDueno}
        textoBoton="Guardar cambios"
        alGuardar={async (d) => {
          const cambios: Partial<DatosJugador> = { nombre: d.nombre, apellido: d.apellido, telefono: d.telefono, email: d.email, camada: d.camada };
          if (props.esDueno) cambios.dni = d.dni;
          await api.editarJugador(j.id, cambios);
          await props.alListo("Datos guardados.");
        }}
        alCancelar={() => setEditando(false)}
      />
    );
  }
  return (
    <div className="panel detalle-jugador">
      <dl>
        <div><dt>DNI</dt><dd>{formatearDni(j.dni)}</dd></div>
        <div><dt>Celular</dt><dd>{j.telefono ?? "—"}</dd></div>
        <div><dt>Email</dt><dd>{j.email ?? "—"}</dd></div>
        <div><dt>Camada</dt><dd>{j.camada ?? "—"}</dd></div>
      </dl>
      <CuotasDelJugador jugadorId={j.id} nombre={nombre} activo={j.estado === "ACTIVO"} esDueno={props.esDueno} alCambiar={props.alAvisar} alFallar={props.alFallar} />
      <button type="button" className="boton secundario chico" onClick={() => setEditando(true)}>Editar datos</button>
      {props.esDueno && j.estado === "ACTIVO" && (
        <button type="button" className="boton secundario chico"
          onClick={() => window.confirm(`¿Dar de baja a ${nombre}? Deja de generar cuotas y sale de las listas. Lo podés reactivar cuando quieras.`) && void hacer(() => api.bajaJugador(j.id), `${nombre} quedó de baja.`)}>
          Dar de baja
        </button>
      )}
      {props.esDueno && j.estado === "BAJA" && (
        <button type="button" className="boton secundario chico" onClick={() => void hacer(() => api.reactivarJugador(j.id), `${nombre} volvió a estar activo.`)}>
          Reactivar
        </button>
      )}
      {props.esDueno && (
        <button type="button" className="boton peligro"
          onClick={() => {
            const escrito = window.prompt(
              `Eliminar es para siempre. Si ${nombre} tiene pagos, se borran sus datos personales y sus pagos quedan como "Jugador eliminado".\n\nPara confirmar, escribí su nombre y apellido:`,
            );
            if (escrito === null) return;
            void hacer(async () => {
              const r = await api.eliminarJugador(j.id, escrito);
              return r;
            }, `${nombre} fue eliminado.`);
          }}>
          Eliminar
        </button>
      )}
    </div>
  );
}

const ETIQUETA: Record<VistaImportacion["filas"][number]["estado"], string> = { NUEVO: "Nuevo", YA_ESTA: "Ya está", ERROR: "Error" };

function Importar(props: { alListo: (texto: string) => Promise<void>; alCancelar: () => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function elegido(archivo: File | undefined) {
    if (!archivo) return;
    setError(null);
    setVista(null);
    setTrabajando(true);
    try {
      const texto = await archivo.text();
      setCsv(texto);
      setVista(await api.analizarImportacion(texto));
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setTrabajando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function importar() {
    if (!csv) return;
    setTrabajando(true);
    try {
      const r = await api.importarJugadores(csv);
      await props.alListo(r.importados === 1 ? "Se cargó 1 jugador." : `Se cargaron ${r.importados} jugadores.`);
    } catch (e) {
      setError(mensajeDe(e));
      setTrabajando(false);
    }
  }

  const problemas = vista?.filas.filter((f) => f.estado !== "NUEVO") ?? [];
  return (
    <div className="panel">
      <p className="ayuda">
        En la planilla de respuestas del formulario: <strong>Archivo → Descargar → Valores separados por comas (.csv)</strong>. Después elegí ese archivo acá. Antes de cargar nada te muestro qué va a pasar con cada fila.
      </p>
      <input ref={entrada} type="file" accept=".csv,text/csv" className="oculto" tabIndex={-1} onChange={(e) => void elegido(e.target.files?.[0])} />
      <button type="button" className="boton secundario" disabled={trabajando} onClick={() => entrada.current?.click()}>
        {trabajando && !vista ? "Leyendo el archivo…" : vista ? "Elegir otro archivo" : "Elegir archivo .csv"}
      </button>
      {error && <p className="aviso error" role="alert">{error}</p>}
      {vista && (
        <>
          <p className={`aviso ${vista.resumen.nuevos > 0 ? "ok" : "error"}`} role="status">
            {vista.resumen.nuevos} nuevos para cargar · {vista.resumen.yaEstan} ya estaban · {vista.resumen.conError} con errores
          </p>
          {problemas.length > 0 && (
            <ul className="lista lista-importacion">
              {problemas.map((f) => (
                <li key={f.fila}>
                  <span className="datos">
                    <strong>Fila {f.fila}: {[f.nombre, f.apellido].filter(Boolean).join(" ") || "(sin nombre)"}</strong>
                    <span>{f.motivo}</span>
                  </span>
                  <span className={`chip ${f.estado === "ERROR" ? "naranja" : "gris"}`}>{ETIQUETA[f.estado]}</span>
                </li>
              ))}
            </ul>
          )}
          {vista.resumen.conError > 0 && (
            <p className="ayuda">Las filas con error no se cargan. Corregilas en la planilla y volvé a importar: las que ya estén cargadas no se duplican.</p>
          )}
          {vista.resumen.nuevos > 0 && (
            <button type="button" className="boton principal" disabled={trabajando} onClick={() => void importar()}>
              {trabajando ? "Cargando…" : `Cargar ${vista.resumen.nuevos} ${vista.resumen.nuevos === 1 ? "jugador" : "jugadores"}`}
            </button>
          )}
        </>
      )}
      <button type="button" className="boton secundario" onClick={props.alCancelar}>Cancelar</button>
    </div>
  );
}
