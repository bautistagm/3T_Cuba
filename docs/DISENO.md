# 3T — Documento de diseño (Etapa 1)

> Estado: **borrador para aprobar**. Ningún código se escribe hasta que este documento esté aprobado.
> Prototipo visual: canvas "3T – Prototipo" (16 pantallas).

## 1. Qué es 3T

App de gestión del tercer tiempo del plantel: cobro de cuotas, fiestas, sábados (invitados y cocina por camada), caja y, desde 2027, stock y proveedores.

**Quién la usa**

| Actor | Cómo entra | Qué puede hacer |
|---|---|---|
| Dueño (Bautista) | App instalada en el celular (PWA), con login | **Todo.** Es el único que puede anular, dar de baja, eliminar, cambiar montos y gestionar administradores |
| Administradores (hasta 5) | App instalada, con login | Operar: registrar pagos, revisar comprobantes, cargar gastos, cobrar invitados, puerta de fiesta. Solo registran: no pueden anular, eliminar, dar de baja ni cambiar montos |
| Jugadores (~150) | Solo links personales por WhatsApp, sin login ni instalación | Ver su cuota, pagar, adherirse al débito, subir comprobante |
| Responsable de la camada que cocina | Link por WhatsApp válido para esa fecha | Subir fotos de tickets |
| Gente de afuera (fiestas) | Link público de venta | Comprar entradas |

## 2. Reglas de negocio acordadas

**Cuotas**
- Una cuota por mes, **igual para todos los jugadores**. Sin becas, sin descuentos, sin pagos parciales.
- El monto puede cambiar mes a mes (meses con fiesta son más caros). Se fija antes del día 1.
- Los jugadores no pagan entrada a las fiestas: la fiesta va incluida en la cuota de ese mes.
- No hay fecha de vencimiento formal; el objetivo es cobrar en los primeros días del mes.
- Altas, bajas y lesionados: pagan igual que todos mientras estén activos.

**Medios de pago**
- Link de pago personal (Mercado Pago), débito automático el día 1 (suscripción de Mercado Pago), transferencia al alias con comprobante, efectivo entregado a un administrador.
- La cuenta es, por ahora, un **alias personal dedicado solo al plantel**. Cambiar a una cuenta del club es solo cambiar credenciales.
- Un jugador puede pagar más de un mes junto (ej.: noviembre y diciembre).

**Recordatorios**
- Día 1: mensaje con el monto, el link de pago y la invitación al débito automático.
- Recordatorios automáticos a los que deben en días configurables (por defecto 3, 5, 7 y 10, a las 10:00). El que paga deja de recibirlos al instante.

**Invitados del tercer tiempo**
- No se registran por nombre: van a una **cuenta genérica** por sábado. Se anota cada cobro (monto, medio, quién cobró, nota opcional).

**Cocina por camada (sábados de local)**
- Un sábado de por medio, cuando el plantel juega de local, cocina una camada distinta. La camada y el presupuesto se asignan unos días antes y **el monto cambia según la fecha**.
- El responsable de la camada saca fotos de los tickets; la IA los registra como gastos **producto por producto**. Los administradores pueden agregar gastos a mano.
- Al cerrar la fecha se rinde: si sobra plata, la camada la devuelve; si se pasaron, queda registrado.

**Fiestas**
- Venta de entradas a gente de afuera, por tandas con precio y cupo. Entradas nominales (nombre + DNI) con un código único.
- **Tipos de entrada con precios distintos** (por ejemplo, mujer y hombre), dentro de cada tanda. Un solo link de venta: el comprador elige el tipo, y la entrada sale a su nombre y DNI con el tipo bien visible.
- **El tipo se controla en la puerta con el DNI.** La página de compra lo avisa antes de pagar. Si el DNI no coincide con el tipo comprado, en la puerta se cobra la diferencia (queda registrada en la caja de la fiesta) o no se deja pasar. Cada entrada es nominal: no se transfiere.
- **Entrada con código QR**: al acreditarse el pago, el comprador recibe por WhatsApp su entrada con un QR (un código aleatorio firmado, imposible de adivinar).
- **Puerta desde el celular**: cualquier admin escanea el QR con la cámara desde la app. La pantalla muestra en grande nombre, DNI y tipo, o un aviso rojo si la entrada ya se usó (con la hora y quién la marcó), está anulada o no existe. Cada QR entra una sola vez: si alguien comparte la captura, entra solo el primero.
- También se puede buscar por nombre o DNI. La lista de la fiesta se descarga al celular antes de abrir la puerta, para que funcione aunque haya mala señal; al volver la conexión se sincroniza.
- Los jugadores figuran en la lista de puerta sin pagar.
- Cada fiesta tiene su resultado: entradas menos gastos.

**Caja**
- Todo movimiento de plata (cuotas, invitados, entradas, gastos, rendiciones de efectivo) queda en un único libro.
- Saldo separado en "cuenta" y "efectivo en manos de cada admin".
- Análisis: gastos por mes con explicación, gasto por categoría y por producto, y preguntas en lenguaje natural a la IA.

## 3. Reglas de seguridad para la plata (no negociables)

1. **Montos en centavos, como enteros** (`BIGINT`). Nunca decimales ni floats.
2. **La plata nunca se borra.** Pagos, gastos y entradas se **anulan** con motivo, autor y fecha. **Solo el dueño anula.**
   - **Jugadores**: el dueño puede **dar de baja** (deja de generar cuotas y sale de las listas, pero se puede reactivar) o **eliminar**. Si el jugador nunca pagó nada, se borra por completo. Si tiene pagos, se borran sus datos personales (nombre, DNI, teléfono, email) y sus pagos quedan como "Jugador eliminado", para que la caja siga cerrando. Eliminar pide escribir el nombre del jugador para confirmar y queda en la auditoría.
3. **Libro de caja de doble partida simplificado**: cada evento de plata genera asientos en `movimientos_caja`. El saldo se calcula sumando asientos; nunca se guarda un saldo "a mano".
4. **Auditoría**: cada cambio de datos guarda quién, cuándo, qué había antes y qué hay después.
5. **Webhooks de Mercado Pago**: se verifica la firma, se guarda el evento y se procesa **una sola vez** (idempotencia por ID de evento). El estado del pago siempre se vuelve a consultar a la API de Mercado Pago; nunca se confía solo en el aviso.
6. **Conciliación diaria automática**: lo registrado en 3T contra lo que informa Mercado Pago. Cualquier diferencia genera una alerta al dueño.
7. **La IA propone, una persona confirma** cuando hay dudas. Un comprobante se confirma solo si monto, fecha y número de operación coinciden exactamente con un movimiento real de la cuenta. Todo lo demás va a la bandeja "Revisar".
8. **Operaciones críticas en transacciones**: registrar un pago, imputarlo y asentarlo en caja ocurre todo junto o no ocurre.
9. **Links personales** con tokens largos y aleatorios, que se pueden revocar. Los links de camada vencen al cerrar la fecha.
10. **Secretos** (credenciales de Mercado Pago, WhatsApp, IA) solo en variables de entorno del servidor, nunca en el código ni en el repositorio.
11. **Backups diarios** de la base de datos, con restauración probada.

## 4. Arquitectura técnica

```
3T_Cuba/
├── apps/
│   ├── api/        Backend: Node.js + TypeScript, Fastify, Prisma, PostgreSQL
│   └── web/        Frontend: React + TypeScript + Vite, PWA (panel admin + páginas públicas)
├── packages/
│   └── shared/     Tipos, validaciones (Zod) y utilidades de dinero compartidas
└── docs/           Este documento y los siguientes
```

| Pieza | Elección | Por qué |
|---|---|---|
| Lenguaje | TypeScript en todo | Un solo lenguaje y tipos compartidos entre backend y frontend |
| API | Fastify + Zod | Rápida, simple, validación estricta de cada entrada |
| Base de datos | PostgreSQL + Prisma | Transacciones confiables, migraciones versionadas |
| Frontend | React + Vite como PWA | Se instala en el celular sin tienda de apps |
| Tests | Vitest + base de datos real en Docker para integración | Los flujos de plata se prueban contra una base real |
| CI | GitHub Actions | Cada cambio corre tests y chequeos antes de integrarse |
| Pagos | API de Mercado Pago (Checkout Pro, Suscripciones, Webhooks) | Ya conocida por los jugadores |
| Mensajes | WhatsApp: al principio botón con mensaje armado; después API oficial (Cloud API) | Arranca rápido, se automatiza cuando esté aprobado por Meta |
| IA | API de Claude para leer tickets/comprobantes y responder preguntas de caja | Salida estructurada y verificable |
| Hosting | A definir en la Etapa 2 (servicio administrado con Postgres y backups) | Costo estimado bajo |

## 5. Modelo de datos

Convenciones: `id` UUID; `*_centavos` BIGINT; `creado_en` / `actualizado_en` en todas las tablas; estados como enums.

### Personas y acceso
- **admins**: nombre, email, teléfono, rol (`DUENO` | `ADMIN`), activo.
- **jugadores**: nombre, apellido, DNI (único), teléfono WhatsApp, email, camada, estado (`ACTIVO` | `BAJA` | `ELIMINADO`), fecha de alta, fecha de baja, token del link personal.

### Cuotas y pagos
- **periodos_cuota**: año, mes (únicos juntos), monto_centavos, es_mes_fiesta, nota, estado (`ABIERTO` | `CERRADO`).
- **cargos**: lo que debe cada jugador en cada período. jugador, período (únicos juntos), monto_centavos, estado (`PENDIENTE` | `PAGADO` | `ANULADO`).
- **pagos**: todo dinero que entra. origen (`CUOTA` | `INVITADO` | `ENTRADA_FIESTA` | `DEVOLUCION_COCINA` | `OTRO`), monto_centavos, medio (`MP_LINK` | `MP_DEBITO` | `TRANSFERENCIA` | `EFECTIVO`), estado (`PENDIENTE` | `CONFIRMADO` | `ANULADO`), id de pago de Mercado Pago (único), recibido_por (admin, si es efectivo), comprobante, sábado o fiesta asociados, motivo/autor de anulación.
- **imputaciones**: qué cargos cancela cada pago (pago, cargo, monto). Permite pagar dos meses juntos.
- **suscripciones_debito**: jugador, id de suscripción de Mercado Pago, estado, monto actual.
- **comprobantes**: archivo, datos leídos por la IA, nivel de coincidencia, jugador sugerido, estado (`PENDIENTE_REVISION` | `CONFIRMADO` | `RECHAZADO`), quién lo revisó.
- **notificaciones**: destinatario, tipo (aviso del día 1, recordatorio, confirmación, entrada), canal, estado, error, fecha de envío.

### Sábados y cocina
- **sabados**: fecha, es_local, notas.
- **cocinas**: sábado, camada, nombre y teléfono del responsable, presupuesto_centavos (variable por fecha), token del link para tickets, estado (`ABIERTA` | `CERRADA`), resultado de la rendición.

### Gastos
- **gastos**: categoría (carne, bebidas, insumos, fiesta, otros), proveedor (texto por ahora; tabla en 2027), descripción, total_centavos, fecha, medio, pagado_por, foto del ticket, origen de la carga (`IA` | `MANUAL`), contexto (cocina, fiesta o sábado), estado (`CONFIRMADO` | `ANULADO`).
- **gasto_items**: el detalle del ticket, producto por producto: descripción, cantidad, unidad, precio unitario, subtotal. En 2027 se vincula a un producto del stock.

### Fiestas
- **fiestas**: nombre, fecha y hora, lugar, cupo, estado.
- **tandas**: fiesta, nombre, precio_centavos, cupo, desde, hasta, orden.
- **tipos_entrada**: tanda, nombre (ej. "Mujer", "Hombre"), precio_centavos.
- **entradas**: fiesta, tanda, tipo de entrada, origen (`EXTERNA` | `JUGADOR`), nombre, DNI, teléfono, código único, pago, estado (`VALIDA` | `USADA` | `ANULADA`), hora de ingreso y quién la marcó, diferencia cobrada en puerta (si hubo).

### Caja y control
- **movimientos_caja**: el libro único. fecha, tipo (`INGRESO` | `EGRESO` | `TRANSFERENCIA_INTERNA`), cuenta (`CUENTA` | `EFECTIVO:<admin>`), monto_centavos con signo, referencia al pago, gasto o rendición que lo originó.
- **rendiciones**: un admin entrega o deposita efectivo: admin, monto, destino, confirmado por.
- **eventos_webhook**: proveedor, id del evento (único), contenido, procesado_en, resultado.
- **conciliaciones**: fecha, resultado, diferencias encontradas.
- **auditoria**: actor, acción, entidad, id, antes, después, fecha, IP.

### 2027 (solo previsto)
- **proveedores**, **productos**, **movimientos_stock**, **conteos_sabado**. Una compra a proveedor genera un gasto en Caja y una entrada en Stock al mismo tiempo.

## 6. Plan por etapas

| # | Etapa | Resultado |
|---|---|---|
| 1 | **Diseño** (este documento) | Aprobado por el dueño |
| 2 | Base del backend | Monorepo, base de datos, login, roles, auditoría, libro de caja, tests y CI |
| 3 | Jugadores | Alta, baja y modificación; importación desde el Formulario de Google |
| 4 | Cuotas y pagos manuales | Períodos, cargos, efectivo, transferencias, anulaciones, rendición de efectivo |
| 5 | Panel de administración: Pagos | Pantallas de la sección Pagos funcionando con datos reales |
| 6 | Mercado Pago: links de pago | Links personales, webhooks y conciliación diaria (primero en modo de prueba) |
| 7 | Débito automático | Suscripciones con cobro el día 1 y ajuste de monto mensual |
| 8 | WhatsApp | Aviso del día 1, recordatorios y confirmaciones |
| 9 | Comprobantes con IA | Lectura, coincidencia y bandeja "Revisar" |
| 10 | Sábados | Invitados, cocina por camada y gastos con foto del ticket |
| 11 | Caja y análisis | Libro, saldos, gráficos y preguntas a la IA |
| 12 | Fiestas | Tandas, venta pública, entradas con código y puerta |
| 13 | Stock y proveedores | 2027 |

Cada etapa termina con: tests pasando, revisión del dueño y prueba en un entorno de prueba antes de pasar a la siguiente.

## 7. Pendientes para decidir más adelante

- Hosting (Etapa 2).
- Monto de cada cuota, precio de invitados, alias de la cuenta (antes de usar plata real).
- Número de WhatsApp para los mensajes y trámite con Meta (Etapa 8).
- Consulta con un contador sobre Ingresos Brutos de la cuenta personal (antes de usar plata real).
