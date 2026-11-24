/**
 * Gráficos de una fiesta: a qué hora entró la gente, cómo se vendieron las entradas y quiénes vinieron.
 * Se calculan con la lista de la fiesta (no hay datos nuevos en el servidor).
 */
import { useState } from "react";
import type { DetalleFiesta } from "../api";

const zona = "America/Argentina/Buenos_Aires";
const horaMin = (d: Date) => new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zona }).format(d);
const diaCorto = (d: Date) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "numeric", timeZone: zona }).format(d);
const claveDia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(d); // 2026-12-05

interface Barra {
  etiqueta: string;
  valor: number;
  detalle: string;
}

/** Barras simples, una sola serie. El pico se marca con su número; el resto se ve al tocar la barra. */
function Barras(props: { barras: Barra[]; marcas?: { indice: number; texto: string }[]; descripcion: string }) {
  const [elegida, setElegida] = useState<number | null>(null);
  const ancho = 340;
  const alto = 150;
  const abajo = 22;
  const max = Math.max(1, ...props.barras.map((b) => b.valor));
  const paso = ancho / Math.max(1, props.barras.length);
  const grosor = Math.max(4, Math.min(28, paso - 2));
  const pico = props.barras.reduce((m, b, i) => (b.valor > (props.barras[m]?.valor ?? 0) ? i : m), 0);
  const cadaEtiqueta = Math.ceil(props.barras.length / 6);
  const y = (v: number) => alto - abajo - (v / max) * (alto - abajo - 18);
  const vista = elegida ?? pico;
  const mostrada = props.barras[vista];
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={props.descripcion}>
        <line x1="0" x2={ancho} y1={alto - abajo} y2={alto - abajo} className="eje" />
        {props.marcas?.map((m) => (
          <g key={`${m.indice}-${m.texto}`}>
            <line x1={m.indice * paso + 1} x2={m.indice * paso + 1} y1="4" y2={alto - abajo} className="marca" />
            <text x={m.indice * paso + 4} y="12" className="texto-marca">{m.texto}</text>
          </g>
        ))}
        {props.barras.map((b, i) => {
          const x = i * paso + (paso - grosor) / 2;
          const arriba = y(b.valor);
          return (
            <g key={i} onMouseEnter={() => setElegida(i)} onClick={() => setElegida(i)} className="barra-grupo">
              <rect x={i * paso} y="0" width={paso} height={alto - abajo} fill="transparent" />
              {b.valor > 0 && (
                <path
                  className={`barra${i === vista ? " activa" : ""}`}
                  d={`M${x},${alto - abajo} V${arriba + 4} q0,-4 4,-4 h${grosor - 8} q4,0 4,4 V${alto - abajo} Z`}
                />
              )}
              {i === pico && b.valor > 0 && <text x={x + grosor / 2} y={arriba - 4} textAnchor="middle" className="valor">{b.valor}</text>}
              {i % cadaEtiqueta === 0 && <text x={i * paso + paso / 2} y={alto - 6} textAnchor="middle" className="etiqueta">{b.etiqueta}</text>}
            </g>
          );
        })}
      </svg>
      {mostrada && <figcaption className="ayuda">{mostrada.detalle}</figcaption>}
    </figure>
  );
}

export function GraficosFiesta(props: { d: DetalleFiesta }) {
  const { d } = props;
  const pagadas = d.entradas.filter((e) => e.estado === "VALIDA" || e.estado === "USADA");
  const usadas = d.entradas.filter((e) => e.estado === "USADA" && e.usadaEn);
  if (pagadas.length === 0) return null;

  // 1) A qué hora entró la gente: de a 15 minutos.
  let ingresos: Barra[] = [];
  let pico: Barra | null = null;
  if (usadas.length > 0) {
    const tiempos = usadas.map((e) => new Date(e.usadaEn as string).getTime());
    const cuarto = 15 * 60_000;
    const desde = Math.floor(Math.min(...tiempos) / cuarto) * cuarto;
    const hasta = Math.floor(Math.max(...tiempos) / cuarto) * cuarto;
    for (let t = desde; t <= hasta; t += cuarto) {
      const valor = tiempos.filter((x) => x >= t && x < t + cuarto).length;
      ingresos.push({ etiqueta: horaMin(new Date(t)), valor, detalle: `De ${horaMin(new Date(t))} a ${horaMin(new Date(t + cuarto))}: ${valor} ${valor === 1 ? "persona" : "personas"}` });
    }
    if (ingresos.length > 48) ingresos = ingresos.slice(0, 48); // más de 12 horas no tiene sentido mostrarlo
    pico = ingresos.reduce((m, b) => (b.valor > m.valor ? b : m), ingresos[0] as Barra);
  }

  // 2) Ventas por día, con el fin de cada tanda.
  const dias = pagadas.filter((e) => e.pagadaEn).map((e) => new Date(e.pagadaEn as string));
  const ventas: Barra[] = [];
  const marcas: { indice: number; texto: string }[] = [];
  if (dias.length > 0) {
    const primero = new Date(`${claveDia(new Date(Math.min(...dias.map((x) => x.getTime()))))}T12:00:00-03:00`);
    const ultimo = new Date(`${claveDia(new Date(Math.max(...dias.map((x) => x.getTime()))))}T12:00:00-03:00`);
    const finesDeTanda = d.tipos.flatMap((t) => t.tandas.map((x) => ({ dia: claveDia(new Date(x.hasta)), tipo: t.nombre })));
    for (let t = primero.getTime(), i = 0; t <= ultimo.getTime() && i < 90; t += 86_400_000, i++) {
      const clave = claveDia(new Date(t));
      const valor = dias.filter((x) => claveDia(x) === clave).length;
      ventas.push({ etiqueta: diaCorto(new Date(t)), valor, detalle: `${diaCorto(new Date(t))}: ${valor} ${valor === 1 ? "entrada vendida" : "entradas vendidas"}` });
      const fin = finesDeTanda.filter((f) => f.dia === clave);
      if (fin.length) marcas.push({ indice: i + 1, texto: "fin tanda" });
    }
  }

  // 3) Quiénes: por tipo, cuántas se vendieron y cuántos vinieron.
  const porTipo = d.tipos.map((t) => {
    const suyas = pagadas.filter((e) => e.tipoId === t.id);
    return { nombre: t.nombre, vendidas: suyas.length, vinieron: suyas.filter((e) => e.estado === "USADA").length };
  });
  const vinieron = pagadas.filter((e) => e.estado === "USADA").length;

  return (
    <section className="tarjeta">
      <h2>Números de la fiesta</h2>
      <div className="numeros">
        <span><span className="ayuda">Vinieron</span><strong>{vinieron} de {pagadas.length}</strong></span>
        <span><span className="ayuda">Asistencia</span><strong>{Math.round((vinieron / pagadas.length) * 100)}%</strong></span>
        {pico && pico.valor > 0 && <span><span className="ayuda">Hora pico</span><strong>{pico.etiqueta}</strong></span>}
      </div>

      <h3>Quiénes</h3>
      <ul className="lista">
        {porTipo.map((t) => (
          <li key={t.nombre}>
            <span className="datos">
              <strong>{t.nombre}</strong>
              <span>{t.vendidas} vendidas · {t.vinieron} vinieron{t.vendidas ? ` (${Math.round((t.vinieron / t.vendidas) * 100)}%)` : ""}</span>
            </span>
            <span className="barra-horizontal" aria-hidden="true">
              <span style={{ width: `${pagadas.length ? (t.vendidas / pagadas.length) * 100 : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>

      {ingresos.length > 0 ? (
        <>
          <h3>A qué hora entró la gente</h3>
          <Barras barras={ingresos} descripcion="Personas que entraron cada 15 minutos" />
        </>
      ) : (
        <p className="ayuda">Cuando empiece a entrar gente vas a ver a qué hora entró la mayoría.</p>
      )}

      {ventas.length > 0 && (
        <>
          <h3>Cómo se vendieron</h3>
          <Barras barras={ventas} marcas={marcas} descripcion="Entradas vendidas por día" />
        </>
      )}
    </section>
  );
}
