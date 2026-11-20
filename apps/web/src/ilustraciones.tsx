/** Dibujos de líneas finas de la pantalla principal. Son decorativos: los lectores de pantalla los saltean. */

const trazo = { fill: "none", stroke: "#14201A", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function DibujoPagos() {
  return (
    <svg width="88" height="70" viewBox="0 0 80 64" aria-hidden="true" {...trazo}>
      <rect x="6" y="12" width="54" height="32" rx="4" />
      <circle cx="33" cy="28" r="7" />
      <path d="M13 20h4M49 36h4" />
      <circle cx="62" cy="44" r="12" fill="#1B4DB1" stroke="#1B4DB1" />
      <path d="M56.5 44.5l4 4 7-8" stroke="#FFFFFF" strokeWidth="2.2" />
    </svg>
  );
}

export function DibujoFiestas() {
  return (
    <svg width="88" height="70" viewBox="0 0 80 64" aria-hidden="true" {...trazo}>
      <path d="M8 18h50v10a5 5 0 0 0 0 10v10H8V38a5 5 0 0 0 0-10z" />
      <path d="M42 18v30" strokeDasharray="3 4" />
      <path d="M25 26l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="#1B4DB1" stroke="#1B4DB1" />
      <path d="M66 10l2 4M74 16l-4 2M70 6v3" />
    </svg>
  );
}

export function DibujoCaja() {
  return (
    <svg width="88" height="70" viewBox="0 0 80 64" aria-hidden="true" {...trazo}>
      <rect x="6" y="22" width="48" height="34" rx="5" />
      <path d="M6 32h48" />
      <circle cx="30" cy="44" r="5" />
      <path d="M66 50V14M60 20l6-6 6 6" stroke="#1B4DB1" strokeWidth="2.2" />
      <path d="M76 14v30M71 39l5 5 5-5" />
    </svg>
  );
}

export function DibujoStock() {
  return (
    <svg width="88" height="70" viewBox="0 0 80 64" aria-hidden="true" {...trazo}>
      <rect x="6" y="30" width="44" height="26" rx="2" />
      <path d="M6 39h44M6 47h44M20 30v26M36 30v26" />
      <path d="M60 10h8v8h-8z" />
      <path d="M56 26q0-6 4-8h8q4 2 4 8v30H56z" />
      <rect x="56" y="34" width="16" height="9" fill="#1B4DB1" stroke="#1B4DB1" />
    </svg>
  );
}

/** Haches de rugby y una pelota, en el fondo de la portada. */
export function DecoracionRugby() {
  return (
    <svg className="decoracion" viewBox="0 0 390 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true"
      fill="none" stroke="#2C323A" strokeWidth="2" strokeLinecap="round">
      <path d="M318 20V250M368 20V250M318 150H368" />
      <path d="M22 30V250M64 30V250M22 160H64" />
      <ellipse cx="345" cy="238" rx="22" ry="13" transform="rotate(-28 345 238)" />
      <path d="M337 234l12 -6M339 239l3 -2M344 236l3 -2M349 233l3 -2" />
    </svg>
  );
}
