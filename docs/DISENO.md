# 3T — Documento de diseño (Etapa 1)

> Estado: **aprobado** (se actualiza con cada decisión nueva).
> Prototipo visual: canvas "3T – Prototipo".

> **Regla principal: costo cero.** La app no puede generar ningún gasto: ni hosting, ni base de datos, ni comisiones, ni mensajes pagos, ni IA paga. Toda pieza nueva tiene que tener una opción gratis; si no la tiene, no entra.

## 1. Qué es 3T

App de gestión del tercer tiempo del plantel: cobro de cuotas, fiestas, sábados (invitados y cocina por camada), caja y, desde 2027, stock y proveedores.

**Quién la usa**

| Actor | Cómo entra | Qué puede hacer |
|---|---|---|
| Dueño (Bautista) | App instalada en el celular (PWA), con login | **Todo.** Es el único que puede anular, dar de baja, eliminar, cambiar montos y gestionar administradores |
| Administradores (hasta 5) | App instalada, con login | Operar: registrar pagos, revisar comprobantes, cargar gastos, cobrar invitados, puerta de fiesta. Solo registran: no pueden anular, eliminar, dar de baja ni cambiar montos |
| Jugadores (~150) | Solo un link personal, sin login ni instalación | Ver su cuota, ver el alias y subir el comprobante de su transferencia |
| Responsable de la camada que cocina | Link por WhatsApp válido para esa fecha | Subir fotos de tickets |
| Gente de afuera (fiestas) | Link público de venta | Ver el alias, cargar sus datos y subir el comprobante de la transferencia |

## 2. Reglas de negocio acordadas

**Cuotas**
- Una cuota por mes, **igual para todos los jugadores**. Sin becas, sin descuentos, sin pagos parciales.
- El monto puede cambiar mes a mes (meses con fiesta son más caros). Se fija antes del día 1.
- Los jugadores no pagan entrada a las fiestas: la fiesta va incluida en la cuota de ese mes.
- No hay fecha de vencimiento formal; el objetivo es cobrar en los primeros días del mes.
- Altas, bajas y lesionados: pagan igual que todos mientras estén activos.

**Medios de pago** (sin comisiones)
- **Transferencia al alias** del plantel, con comprobante. No se usan links de pago ni débito automático de Mercado Pago porque cobran comisión.
- **Efectivo** entregado a un administrador.
- Quien quiera "débito automático" programa en su propio banco o billetera una transferencia automática el día 1. Es gratis y para la app es una transferencia más.
- **La cuenta es la de Mercado Pago personal del dueño** (decisión del dueño; opción "A"). La plata del plantel convive con la personal:
  - La app lee los movimientos que entran a la cuenta (solo lectura) y **solo guarda los que coinciden con un pago del plantel**; el resto se descarta sin almacenarlo.
  - Para no gastar la plata del plantel sin querer, el dueño la aparta en una **reserva** de Mercado Pago. La app le dice cuánto tendría que haber apartado.
  - Si más adelante se usa otra cuenta (de un tesorero o del club), es solo cambiar el alias y las credenciales.
- Un jugador puede pagar más de un mes junto (ej.: noviembre y diciembre).

**Verificación automática de transferencias con IA**
- El jugador (o el comprador de una entrada) sube la captura del comprobante en su link. La IA lee fecha, hora, monto, nombre y CUIT/CUIL de quien pagó, banco y número de operación.
- La app cruza esos datos con los **movimientos reales de la cuenta**, leídos de Mercado Pago en modo solo lectura (sin costo). Si coinciden monto, fecha y número de operación, el pago se **confirma solo** y se imputa a la persona correcta.
- Un mismo número de operación no se puede usar dos veces (evita que dos personas presenten el mismo comprobante).
- Si algo no coincide o falta (comprobante editado, monto distinto, la plata todavía no figura), va a la bandeja **"Revisar"** para que lo resuelva un admin. La IA nunca confirma algo que no pudo verificar contra la cuenta.

**Recordatorios** (sin envíos automáticos por ahora)
- La app arma la **lista de los que faltan pagar** del mes, con su teléfono. Los admins deciden cómo avisarle a cada uno.
- Desde la lista, un botón abre WhatsApp con un mensaje ya escrito para esa persona (gratis, lo envía el admin).

**Sábados**
- Casi todos los sábados hay tercer tiempo con invitados: la app tiene siempre listo el sábado actual (o el próximo) sin que haya que crearlo. Se puede marcar si ese sábado el plantel juega **de local**.

**Invitados del tercer tiempo**
- Todos pagan **el mismo precio**, que fija el dueño y puede cambiar cuando quiera. Cobrar es un toque.
- Cada cobro va a la cuenta del sábado: monto, medio (efectivo o transferencia), quién cobró y, **opcionalmente, el nombre y la camada** del invitado, y una nota.

**Cocina por camada (sábados de local)**
- Un sábado de por medio, cuando el plantel juega de local, cocina una camada distinta. La camada se asigna unos días antes.
- **La camada dice cuánto necesita y el plantel le transfiere esa plata desde la caja (adelanto).** Si después piden más, se registra otra transferencia. El monto cambia según la fecha.
- La plata adelantada queda en la caja como "en manos de la camada" hasta que se rinde.
- El responsable de la camada saca fotos de los tickets desde un link (sin bajarse nada); la IA los registra automáticamente como gastos **producto por producto**. Si los números del ticket no cierran (los productos no suman el total), el ticket va a "Revisar". Los administradores pueden agregar gastos a mano.
- **Cerrar y rendir:** si sobró plata, la camada la devuelve (por transferencia o en efectivo a un admin); si gastaron de más, el plantel les reintegra la diferencia. Solo el dueño puede cerrar dejando una diferencia sin devolver o sin reintegrar, con motivo.

**Fiestas**
- **No hay fiestas por defecto.** El dueño crea cada fiesta desde la sección Fiestas.
  - **Obligatorio:** nombre o motivo, fecha y hora, y el precio de cada tipo de entrada (por defecto "Mujer" y "Hombre").
  - **Opcional:** lugar, cupo total, cupo por tipo y tandas (cada tanda con su precio, cupo y fecha de fin). Sin tandas, cada tipo se vende a un precio único; sin cupo, no hay límite de entradas.
  - Mientras no tenga ventas se puede editar libremente; después, solo el dueño puede cambiar precios futuros.
- **Un link de venta por tipo de entrada** (uno para mujeres, otro para hombres). Cada link vende solo ese tipo, así se puede difundir cada uno por separado.
- **Cómo se compra (sin comisiones):** el link muestra el precio y el **alias del plantel**. La persona transfiere, completa sus datos y sube el comprobante. La IA lo verifica igual que una cuota; si está todo bien, se registra la persona en la lista de la fiesta y **se le manda la entrada con el QR al email** que cargó. Si hay dudas, queda en "Revisar" y la entrada sale cuando un admin lo confirma.
- Entradas **nominales**: nombre, DNI, **email (obligatorio)** y teléfono (opcional). No se transfieren. Si la misma persona compra varias, cada una lleva su nombre y DNI.
- **El tipo se controla en la puerta con el DNI.** La página de compra lo avisa antes de pagar. Si el DNI no coincide con el tipo comprado, en la puerta se cobra la diferencia (queda registrada en la caja de la fiesta) o no se deja pasar.
- **La entrada con su QR llega por email**, desde la casilla del plantel **plantelcuba@gmail.com**. La clave de envío (contraseña de aplicación de Google) se carga solo como secreto del servidor. El QR es un código aleatorio firmado, imposible de adivinar. Si no le llegó, se puede reenviar desde la app.
- **Listas separadas por tipo**: la app muestra los compradores en dos listas (Mujeres / Hombres), con totales de cada una, y se pueden exportar a una planilla con una hoja por tipo.
- **Puerta desde el celular**: cualquier admin escanea el QR con la cámara desde la app. La pantalla muestra en grande nombre, DNI y tipo, o un aviso rojo si la entrada ya se usó (con la hora y quién la marcó), está anulada o no existe. Cada QR entra una sola vez: si alguien comparte la captura, entra solo el primero.
- También se puede buscar por nombre o DNI. La lista de la fiesta se descarga al celular antes de abrir la puerta, para que funcione aunque haya mala señal; al volver la conexión se sincroniza.
- Los jugadores figuran en la lista de puerta sin pagar (la fiesta va incluida en su cuota).
- Cada fiesta tiene su resultado: entradas menos gastos.

**Caja**
- **Arranca en cero** (decisión del dueño): solo cuenta la plata que se mueve desde que se empieza a usar la app.
- Todo movimiento de plata (cuotas, invitados, entradas, gastos, efectivo) queda en un único libro.
- Saldo separado en: la cuenta (lo que tendría que estar apartado en la reserva), **el efectivo que tiene cada admin, con su nombre**, y lo que está en manos de cada camada que cocina.
- **Efectivo con responsable:** el efectivo que cobra un admin queda a su nombre. Puede depositarlo en el alias (pasa a la cuenta) o entregárselo a otro admin o al dueño; en ese caso **el que recibe tiene que confirmarlo en la app**, y recién ahí pasa a ser responsable. Si no lo confirma, sigue a cargo del que lo tenía.
- **Gastos que no son de un sábado** (ej.: compra para el almacén): se cargan en Caja, con foto del ticket leída por IA o a mano, y salen de la cuenta o del efectivo de quien pagó.
- **Control contra la realidad:** el dueño carga cada tanto cuánto tiene apartado en la reserva del plantel. La app lo compara con lo que dice el libro y muestra la diferencia; si la hay, el dueño puede registrar un **ajuste** con motivo (queda en la auditoría y se ve separado en el análisis).
- Análisis: gastos por mes con explicación, gasto por categoría y por producto, y preguntas en lenguaje natural a la IA.

**Inteligencia artificial**
- Se usa **la mejor IA disponible gratis** (hoy, Gemini de Google en su plan gratuito) para leer tickets y comprobantes y para el análisis de Caja. Si mañana aparece una mejor gratis, se cambia.
- Decisión del dueño: se acepta que en el plan gratis el proveedor puede usar lo que se le manda para mejorar sus productos.

## 3. Reglas de seguridad para la plata (no negociables)

1. **Montos en centavos, como enteros** (`BIGINT`). Nunca decimales ni floats.
2. **La plata nunca se borra.** Pagos, gastos y entradas se **anulan** con motivo, autor y fecha. **Solo el dueño anula.**
   - **Jugadores**: el dueño puede **dar de baja** (deja de generar cuotas y sale de las listas, pero se puede reactivar) o **eliminar**. Si el jugador nunca pagó nada, se borra por completo. Si tiene pagos, se borran sus datos personales (nombre, DNI, teléfono, email) y sus pagos quedan como "Jugador eliminado", para que la caja siga cerrando. Eliminar pide escribir el nombre del jugador para confirmar y queda en la auditoría.
3. **Libro de caja de doble partida**: cada evento de plata es un asiento con dos o más movimientos que suman exactamente cero (de dónde sale y adónde va). El saldo se calcula sumando movimientos; nunca se guarda un saldo "a mano". La base de datos rechaza asientos desbalanceados, cambios y borrados, y solo acepta anulaciones que sean el espejo exacto del asiento original.
4. **Auditoría**: cada cambio de datos guarda quién, cuándo, qué había antes y qué hay después.
5. **Mercado Pago solo en lectura**: la app lee los movimientos de la cuenta pero no puede mover plata. Cada movimiento se usa para confirmar un único pago.
   - Mercado Pago no ofrece una clave de "solo lectura": la clave de acceso técnicamente permite mover plata. **El dueño lo aceptó (23/11/2026)** con esta protección: el código que habla con Mercado Pago solo permite consultas (`GET` a una lista cerrada de direcciones) y rechaza cualquier otra cosa; la clave vive solo en Render (`MP_ACCESS_TOKEN`), nunca en el chat ni en el repositorio.
6. **Conciliación diaria automática**: lo registrado en 3T contra los movimientos de la cuenta. Cualquier diferencia queda marcada para el dueño.
7. **La IA confirma sola solo lo que puede verificar.** Un comprobante se confirma automáticamente únicamente si monto, fecha y número de operación coinciden con un movimiento real de la cuenta que no se haya usado antes. Todo lo demás va a la bandeja "Revisar".
8. **Operaciones críticas en transacciones**: registrar un pago, imputarlo y asentarlo en caja ocurre todo junto o no ocurre.
9. **Links personales** con tokens largos y aleatorios, que se pueden revocar. Los links de camada vencen al cerrar la fecha.
10. **Secretos** (credenciales de Mercado Pago, del email, de la IA) solo en variables de entorno del servidor, nunca en el código ni en el repositorio.
11. **Backups diarios** de la base de datos (copia cifrada cada noche con GitHub Actions), con restauración probada.

## 4. Arquitectura técnica

```
3T_Cuba/
├── apps/
│   ├── api/        Backend: Node.js + TypeScript, Fastify, Drizzle ORM, PostgreSQL
│   └── web/        Frontend: React + TypeScript + Vite, PWA (panel admin + páginas públicas)
├── packages/
│   └── shared/     Tipos, validaciones (Zod) y utilidades de dinero compartidas
└── docs/           Este documento y los siguientes
```

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo | Un solo lenguaje y tipos compartidos entre backend y frontend |
| API | Fastify + Zod | Rápida, simple, validación estricta de cada entrada |
| Base de datos | PostgreSQL + Drizzle ORM | Transacciones confiables, migraciones en SQL versionadas y revisables; las reglas de la plata también se protegen dentro de la base |
| Frontend | React + Vite como PWA | Se instala en el celular sin tienda de apps |
| Tests | Vitest + base de datos real en Docker para integración | Los flujos de plata se prueban contra una base real |
| CI | GitHub Actions | Cada cambio corre tests y chequeos antes de integrarse |
| Pagos | Transferencias al alias + API de Mercado Pago solo para leer movimientos | Sin comisiones |
| Mensajes | Botón que abre WhatsApp con el mensaje armado (lo envía el admin). Email desde plantelcuba@gmail.com para las entradas | Gratis |
| IA | La mejor IA con plan gratis (hoy Gemini) para tickets, comprobantes y análisis | Gratis |
| Hosting de pantallas | Render, sitio estático | Gratis y siempre prendido |
| Hosting de la API | Render, plan Free, con un aviso cada 14 minutos para que no se duerma (sin tocar la base) | Gratis |
| Base de datos | Neon, plan Free (PostgreSQL, 1 GB, sin vencimiento) | Gratis |
| Archivos (fotos de tickets y comprobantes) | Almacenamiento de archivos de Neon (plan Free) | Gratis |
| Backups y tareas programadas | GitHub Actions | Gratis |

## 5. Modelo de datos

Convenciones: `id` UUID; `*_centavos` BIGINT; `creado_en` / `actualizado_en` en todas las tablas; estados como enums.

### Personas y acceso
- **admins**: nombre, email, teléfono, rol (`DUENO` | `ADMIN`), activo.
- **jugadores**: nombre, apellido, DNI (único), teléfono WhatsApp, email, camada, estado (`ACTIVO` | `BAJA` | `ELIMINADO`), fecha de alta, fecha de baja, token del link personal.

### Cuotas y pagos
- **periodos_cuota**: año, mes (únicos juntos), monto_centavos, es_mes_fiesta, nota, estado (`ABIERTO` | `CERRADO`).
- **cargos**: lo que debe cada jugador en cada período. jugador, período (únicos juntos), monto_centavos, estado (`PENDIENTE` | `PAGADO` | `ANULADO`).
- **pagos**: todo dinero que entra. origen (`CUOTA` | `INVITADO` | `ENTRADA_FIESTA` | `DEVOLUCION_COCINA` | `OTRO`), monto_centavos, medio (`TRANSFERENCIA` | `EFECTIVO`), estado (`PENDIENTE` | `CONFIRMADO` | `ANULADO`), número de operación de la transferencia (único), movimiento de la cuenta con el que se verificó, recibido_por (admin, si es efectivo), comprobante, sábado o fiesta asociados, motivo/autor de anulación.
- **imputaciones**: qué cargos cancela cada pago (pago, cargo, monto). Permite pagar dos meses juntos.
- **comprobantes**: archivo, para qué es (cuota o entrada), datos leídos por la IA (fecha, monto, nombre y CUIT/CUIL de quien pagó, banco, número de operación), resultado de la verificación contra la cuenta, estado (`VERIFICADO_AUTO` | `PENDIENTE_REVISION` | `CONFIRMADO` | `RECHAZADO`), quién lo revisó.
- **movimientos_cuenta**: copia de los movimientos de entrada leídos de Mercado Pago (id, fecha, monto, quién transfirió), y a qué pago quedó asignado cada uno (como máximo uno).
- **notificaciones**: destinatario, tipo (confirmación de pago, entrada), canal (`EMAIL`), estado, error, fecha de envío.

### Sábados y cocina
- **parametros**: valores que fija el dueño, como el precio de los invitados.
- **sabados**: fecha (única), es_local, notas.
- **pagos** con origen `INVITADO`: además de lo general, sábado, nombre (opcional) y camada (opcional) del invitado.
- **cocinas**: sábado (una por sábado), camada, nombre y teléfono del responsable, token del link para tickets (se guarda solo su hash), estado (`ABIERTA` | `CERRADA`), cómo se cerró. Cada cocina tiene su cuenta de caja "en manos de la camada"; lo transferido, gastado, devuelto y reintegrado sale de los asientos de esa cuenta.
- **movimientos_cocina**: la plata entre el plantel y la camada: adelanto, devolución, reintegro, sobrante no devuelto o exceso no reintegrado (estos dos últimos, solo el dueño). Se anulan, no se borran.

### Gastos
- **gastos**: categoría (carne, bebidas, insumos, fiesta, otros), proveedor (texto por ahora; tabla en 2027), descripción, total_centavos, fecha, medio, pagado_por, foto del ticket, origen de la carga (`IA` | `MANUAL`), contexto (cocina, fiesta o sábado), estado (`CONFIRMADO` | `ANULADO`).
- **gasto_items**: el detalle del ticket, producto por producto: descripción, cantidad, categoría y subtotal. Los productos tienen que sumar exactamente el total del gasto (la base lo controla). En 2027 se vincula a un producto del stock.
- **tickets**: la foto, lo que leyó la IA y el estado (`REGISTRADO` | `REVISAR` | `DESCARTADO`). Un ticket se registra solo si es un ticket, se lee y los productos suman el total; si no, o si la misma foto ya se había subido, va a "Revisar".
- **archivos**: las fotos, guardadas comprimidas en la base (son pocas y chicas).

### Fiestas
- **fiestas**: nombre o motivo, fecha y hora, lugar (opcional), cupo (opcional), estado (`BORRADOR` | `A_LA_VENTA` | `CERRADA` | `FINALIZADA`), creada por.
- **tipos_entrada**: fiesta, nombre (ej. "Mujer", "Hombre"), precio_centavos (precio único si no hay tandas), cupo (opcional), token del link de venta propio.
- **tandas** (opcionales): tipo de entrada, nombre, precio_centavos, cupo (opcional), desde, hasta, orden. Si un tipo tiene tandas, manda el precio de la tanda vigente.
- **entradas**: fiesta, tanda, tipo de entrada, origen (`EXTERNA` | `JUGADOR`), nombre, DNI, email, teléfono, código único, pago, estado (`PENDIENTE_PAGO` | `VALIDA` | `USADA` | `ANULADA`), hora de ingreso y quién la marcó, diferencia cobrada en puerta (si hubo).

### Caja y control
- **cuentas_caja**: dónde está la plata (`ACTIVO`: la cuenta del alias, el efectivo de cada admin) y por qué entra o sale (`INGRESO`: cuotas, invitados, entradas; `EGRESO`: carne, bebidas, insumos, fiesta...).
- **asientos_caja**: cada evento de plata: fecha, descripción, origen (pago, gasto, rendición, anulación, ajuste) y a qué asiento anula, si es una anulación.
- **movimientos_caja**: las líneas de cada asiento: cuenta y monto_centavos con signo. Las líneas de un asiento suman cero.
- **traspasos_efectivo**: un admin le entrega efectivo a otro: de quién, para quién, monto, estado (`PENDIENTE` | `CONFIRMADO` | `RECHAZADO` | `CANCELADO`). El asiento de caja se registra recién cuando el que recibe confirma.
- **controles_caja**: lo que el dueño declaró que hay en la reserva, lo que decía el libro, la diferencia y, si se ajustó, el asiento del ajuste.
- **conciliaciones**: fecha, resultado, diferencias encontradas.
- **auditoria**: actor, acción, entidad, id, antes, después, fecha, IP.

### 2027 (solo previsto)
- **proveedores**, **productos**, **movimientos_stock**, **conteos_sabado**. Una compra a proveedor genera un gasto en Caja y una entrada en Stock al mismo tiempo.

## 6. Plan por etapas

Los jugadores reales se cargan en **febrero de 2027**. Hasta entonces se construye todo y se prueba con jugadores de prueba; primero lo que no depende de ellos.

| # | Etapa | Resultado |
|---|---|---|
| 1 | Diseño | ✅ Aprobado |
| 2 | Base del backend | ✅ Monorepo, base de datos, login, roles, auditoría, libro de caja, tests y CI |
| 3 | ✅ Publicación gratis + pantalla principal | La app instalada en el celular del dueño: login, instalación del dueño, pantalla principal con el escudo y gestión de administradores |
| 4 | ✅ Sábados | Invitados, cocina por camada y gastos con foto del ticket leída por IA |
| 5 | ✅ Caja y análisis | Libro, saldos, efectivo con responsable, traspasos entre admins, control contra la reserva, gráficos y preguntas a la IA |
| 6 | Verificación de transferencias con IA | Lectura de comprobantes, cruce con los movimientos de la cuenta y bandeja "Revisar". **Decisión del dueño (23/11/2026):** en esta etapa se arma el motor y la bandeja, pero no se conecta todavía a ningún cobro; lo estrenan cuotas (etapa 9) y fiestas (etapa 7). Incluye una prueba de conexión para el dueño, para ver cómo aparece una transferencia real de prueba. |
| 7 | Fiestas | Creación, venta por alias con comprobante, entradas con QR por email y puerta |
| 8 | Jugadores | Alta, baja, eliminación e importación desde el Formulario de Google (se usa en febrero) |
| 9 | Cuotas y pagos | Períodos, cargos, efectivo, transferencias verificadas, anulaciones, rendiciones y lista de deudores |
| 10 | Stock y proveedores | 2027 |

Cada etapa termina con: tests pasando, revisión del dueño y prueba en un entorno de prueba antes de pasar a la siguiente.

## 7. Pendientes para decidir más adelante

- Monto de cada cuota, precio de invitados, alias de la cuenta (antes de usar plata real).
- Contraseña de aplicación de Google para enviar desde plantelcuba@gmail.com (Etapa 7).
- Consulta con un contador sobre Ingresos Brutos de la cuenta personal (antes de usar plata real).
- Cambio de contraseña propio y "blanquear" la contraseña de un administrador (antes de usar la app con plata real).
- Aviso cada 14 minutos para que la app no se duerma, y backups nocturnos (antes de usar la app con plata real).
