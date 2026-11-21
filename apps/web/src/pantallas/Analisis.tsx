import { useEffect, useState, type FormEvent } from "react";
import { api, type Analisis, type Categoria } from "../api";
import { Cargando, mensajeDe } from "../componentes/comunes";
import { pesos } from "../plata";

const NOMBRES: Record<Categoria, string> = { CARNE: "Carne", BEBIDAS: "Bebidas", INSUMOS: "Insumos", OTROS: "Otros" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (aaaamm: string) => MESES[Number(aaaamm.slice(5, 7)) - 1] ?? aaaamm;
const nombreMesLargo = (aaaamm: string) => {
  const texto = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${aaaamm}-15T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const enMiles = (centavos: bigint) => `$${(Number(centavos / 100n) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 0 })} mil`;

export function PanelAnalisis() {
  const [datos, setDatos] = useState<Analisis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [explicacion, setExplicacion] = useState<Record<string, string>>({});
  const [explicando, setExplicando] = useState(false);

  useEffect(() => {
    api.analisis().then((d) => {
      setDatos(d);
      setElegido(d.gastosPorMes.at(-1)?.mes ?? null);
    }).catch((e: unknown) => setError(mensajeDe(e)));
  }, []);

  if (error) return <main className="contenido"><p className="aviso error" role="alert">{error}</p></main>;
  if (!datos) return <Cargando />;

  const meses = datos.gastosPorMes.slice(-7);
  const maximo = meses.reduce((m, x) => (BigInt(x.totalCentavos) > m ? BigInt(x.totalCentavos) : m), 0n);
  const mes = datos.gastosPorMes.find((m) => m.mes === elegido);
  const ingresoMes = datos.ingresosPorMes.find((m) => m.mes === elegido);
  const totalMes = mes ? BigInt(mes.totalCentavos) : 0n;
  const maxProducto = datos.productos[0] ? BigInt(datos.productos[0].totalCentavos) : 0n;

  async function explicar() {
    if (!elegido) return;
    setExplicando(true);
    try {
      const r = await api.explicarMes(elegido);
      setExplicacion((e) => ({ ...e, [elegido]: r.explicacion }));
    } catch (e) {
      setExplicacion((x) => ({ ...x, [elegido]: mensajeDe(e) }));
    } finally {
      setExplicando(false);
    }
  }

  return (
    <main className="contenido">
      <section className="tarjeta" aria-labelledby="titulo-meses">
        <h2 id="titulo-meses">Gastos por mes</h2>
        <p className="ayuda">Tocá un mes para ver en qué y por qué.</p>
        {maximo === 0n ? (
          <p className="ayuda">Todavía no hay gastos registrados.</p>
        ) : (
          <div className="grafico" role="group" aria-label="Gastos de los últimos meses">
            {meses.map((m) => {
              const total = BigInt(m.totalCentavos);
              const alto = Number((total * 120n) / maximo);
              const activo = m.mes === elegido;
              return (
                <button key={m.mes} type="button" className="barra-mes" aria-pressed={activo}
                  aria-label={`${nombreMesLargo(m.mes)}: ${pesos(total)}`} onClick={() => setElegido(m.mes)}>
                  <span className="valor">{activo && total > 0n ? enMiles(total) : ""}</span>
                  <span className={`barra ${activo ? "activa" : ""}`} style={{ height: `${Math.max(alto, total > 0n ? 4 : 2)}px` }} />
                  <span className={`etiqueta ${activo ? "activa" : ""}`}>{nombreMes(m.mes)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {mes && elegido && (
        <section className="tarjeta destacada" aria-labelledby="titulo-mes">
          <div className="fila-titulo">
            <h2 id="titulo-mes">{nombreMesLargo(elegido)}</h2>
            <strong>{pesos(totalMes)}</strong>
          </div>
          {ingresoMes && BigInt(ingresoMes.totalCentavos) > 0n && <p className="ayuda">Entró {pesos(ingresoMes.totalCentavos)} y salió {pesos(totalMes)}.</p>}
          {(Object.keys(NOMBRES) as Categoria[]).filter((c) => BigInt(mes.porCategoria[c]) > 0n).map((c) => {
            const v = BigInt(mes.porCategoria[c]);
            return (
              <div key={c} className="barra-categoria">
                <div className="fila-titulo"><span>{NOMBRES[c]}</span><strong>{pesos(v)}</strong></div>
                <div className="pista"><div className="relleno" style={{ width: `${Number((v * 100n) / (totalMes || 1n))}%` }} /></div>
              </div>
            );
          })}
          {totalMes > 0n && (
            explicacion[elegido] ? (
              <p className="explicacion"><strong>Por qué: </strong>{explicacion[elegido]}</p>
            ) : (
              <button type="button" className="boton secundario" disabled={explicando} onClick={() => void explicar()}>
                {explicando ? "Pensando…" : "¿Por qué se gastó esto? (IA)"}
              </button>
            )
          )}
        </section>
      )}

      {datos.productos.length > 0 && (
        <section className="tarjeta" aria-labelledby="titulo-productos">
          <h2 id="titulo-productos">En qué productos se va la plata</h2>
          <p className="ayuda">Últimos 6 meses</p>
          {datos.productos.map((p) => {
            const v = BigInt(p.totalCentavos);
            return (
              <div key={p.producto} className="producto-fila">
                <span>{p.producto}</span>
                <div className="pista"><div className="relleno" style={{ width: `${Number((v * 100n) / (maxProducto || 1n))}%` }} /></div>
                <strong>{pesos(v)}</strong>
              </div>
            );
          })}
        </section>
      )}

      <Preguntar />
    </main>
  );
}

const EJEMPLOS = ["¿En qué gastamos más este año?", "¿Cuánto gastamos en carne por mes?", "¿Qué camada gastó más en la cocina?"];

function Preguntar() {
  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [pensando, setPensando] = useState(false);
  async function preguntar(texto: string) {
    setPensando(true);
    setRespuesta(null);
    try {
      setRespuesta((await api.preguntar(texto)).respuesta);
    } catch (e) {
      setRespuesta(mensajeDe(e));
    } finally {
      setPensando(false);
    }
  }
  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (pregunta.trim()) void preguntar(pregunta.trim());
  }
  return (
    <section className="tarjeta oscura" aria-labelledby="titulo-preguntar">
      <h2 id="titulo-preguntar">Preguntale a 3T</h2>
      <p className="ayuda-clara">La IA mira los números de la caja y te explica.</p>
      <div className="botonera">
        {EJEMPLOS.map((e) => (
          <button key={e} type="button" className="ejemplo" disabled={pensando} onClick={() => { setPregunta(e); void preguntar(e); }}>{e}</button>
        ))}
      </div>
      <form onSubmit={enviar} className="fila-pregunta">
        <label className="oculto" htmlFor="pregunta">Tu pregunta</label>
        <input id="pregunta" value={pregunta} maxLength={300} onChange={(e) => setPregunta(e.target.value)} placeholder="Escribí tu pregunta…" />
        <button type="submit" className="boton principal" disabled={pensando}>{pensando ? "…" : "Preguntar"}</button>
      </form>
      {respuesta && <p className="respuesta">{respuesta}</p>}
    </section>
  );
}
