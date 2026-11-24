import { DecoracionRugby } from "../ilustraciones";

/** Política de privacidad pública (la pide Google para poder conectar Gmail). */
export function PaginaPrivacidad() {
  return (
    <>
      <header className="portada">
        <DecoracionRugby />
        <img className="escudo" src="/escudo.png" alt="Escudo del club" />
        <span className="marca">3T</span>
        <span className="saludo">Privacidad</span>
      </header>
      <main className="contenido">
        <section className="tarjeta">
          <h2>Política de privacidad de 3T</h2>
          <p>3T es la app interna del plantel de rugby de CUBA para organizar el tercer tiempo: cuotas, fiestas, sábados y caja. No es una app pública ni se vende.</p>
          <h3>Qué datos usa</h3>
          <ul>
            <li>De los jugadores: nombre, DNI, teléfono y email, para cobrar las cuotas y reconocer sus transferencias.</li>
            <li>De quienes compran entradas: nombre y DNI de cada entrada y un email para mandarles el QR.</li>
            <li>De la cuenta de Mercado Pago del plantel: las transferencias que entran, solo para confirmar pagos. La app no puede mover plata.</li>
          </ul>
          <h3>Gmail</h3>
          <p>La app usa la cuenta plantelcuba@gmail.com con un permiso que <strong>solo permite enviar</strong> emails (las entradas con su QR). No lee, no guarda ni comparte ningún email de la casilla.</p>
          <h3>Qué no hace</h3>
          <p>No vende ni comparte datos con nadie, no muestra publicidad y no usa los datos para otra cosa que el tercer tiempo del plantel.</p>
          <h3>Contacto</h3>
          <p>Para consultar o pedir que se borren tus datos personales, escribí a plantelcuba@gmail.com.</p>
        </section>
      </main>
    </>
  );
}
