import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { api, type PaginaResponsable } from "../api";
import { mensajeDe, useAviso } from "../componentes/comunes";
import { DecoracionRugby } from "../ilustraciones";
import { fechaLarga, pesos } from "../plata";
import { BotonFoto } from "./Cocina";

/** Página del responsable de la camada que cocina: sin login, solo con su link. */
export function PaginaDelResponsable() {
  const { token = "" } = useParams();
  const [datos, setDatos] = useState<PaginaResponsable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { setAviso, Aviso } = useAviso();

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.paginaResponsable(token));
    } catch (e) {
      setError(mensajeDe(e));
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const saldo = datos ? BigInt(datos.saldoCentavos) : 0n;

  return (
    <div className="acceso">
      <header className="portada">
        <DecoracionRugby />
        <img className="escudo" src="/escudo.png" alt="Escudo del club" />
        <span className="marca">3T</span>
        <span className="saludo">{datos ? `Cocina · camada ${datos.camada} · ${fechaLarga(datos.fecha)}` : "Cocina del sábado"}</span>
      </header>
      <main className="contenido">
        <Aviso />
        {error && !datos && <p className="aviso error" role="alert">{error}</p>}
        {!datos && !error && <div className="cargando" aria-label="Cargando" />}
        {datos && (
          <>
            <section className="tarjeta">
              <p className="ayuda">Hola {datos.responsable}. Sacale foto a cada ticket de lo que compren: se registra solo.</p>
              <div className="numeros">
                <span><span className="ayuda">Recibieron</span><strong>{pesos(datos.recibidoCentavos)}</strong></span>
                <span><span className="ayuda">Gastaron</span><strong>{pesos(datos.gastadoCentavos)}</strong></span>
                <span>
                  <span className="ayuda">{saldo >= 0n ? "Les queda" : "Gastaron de más"}</span>
                  <strong>{pesos(saldo < 0n ? -saldo : saldo)}</strong>
                </span>
              </div>
              <BotonFoto
                texto="Sacar foto de un ticket"
                alSubir={async (b64) => {
                  const r = await api.subirTicketResponsable(token, b64);
                  setAviso(
                    r.estado === "REGISTRADO"
                      ? { tipo: "ok", texto: "¡Listo! Ticket registrado." }
                      : { tipo: "ok", texto: "Recibido. Un administrador lo va a revisar porque no se pudo leer todo con seguridad." },
                  );
                  await cargar();
                }}
                alFallar={(m) => setAviso({ tipo: "error", texto: m })}
              />
              {datos.ticketsEnRevision > 0 && (
                <p className="ayuda">{datos.ticketsEnRevision} ticket(s) esperando revisión de un administrador.</p>
              )}
            </section>
            <section className="tarjeta" aria-labelledby="titulo-gastos">
              <h2 id="titulo-gastos">Lo que ya está registrado</h2>
              {datos.gastos.length === 0 && <p className="ayuda">Todavía no hay tickets registrados.</p>}
              {datos.gastos.map((g) => (
                <details key={g.id} className="gasto">
                  <summary>
                    <span className="datos"><strong>{g.proveedor ?? "Compra"}</strong></span>
                    <strong>{pesos(g.totalCentavos)}</strong>
                  </summary>
                  <ul className="items">
                    {g.items.map((i, k) => (
                      <li key={k}><span>{i.descripcion}{i.cantidad ? ` · ${i.cantidad}` : ""}</span><span>{pesos(i.subtotalCentavos)}</span></li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
