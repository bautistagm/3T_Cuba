# Publicar 3T gratis (Neon + Render)

Costo: USD 0. Ninguno de los dos servicios pide tarjeta.
Las claves (la dirección de la base y el código de instalación) se copian directo de un panel al otro: **nunca se pegan en un chat ni en el repositorio**.

## 1. Base de datos en Neon

1. Entrá a https://console.neon.tech y tocá **New project**.
2. Nombre: `3t`. Versión de Postgres: la que venga por defecto. Región: **AWS US East 1 (N. Virginia)** (la misma zona que Render, así responde rápido).
3. Al crearse, Neon muestra la **Connection string**. Tocá **Copy snippet** / el botón de copiar. Empieza con `postgresql://` y termina con `?sslmode=require`.
   Dejala copiada para el paso 2 (no la pegues en ningún otro lado).

## 2. La app en Render

1. Entrá a https://dashboard.render.com, tocá **New +** → **Blueprint**.
2. Elegí el repositorio **bautistagm/3T_Cuba**. Si no aparece, tocá "Configure account" y dale acceso a ese repositorio.
3. Render lee el archivo `render.yaml` y muestra el servicio `plantel-3t` (plan **Free**). Te pide dos valores:
   - **DATABASE_URL**: pegá la Connection string de Neon.
   - **CODIGO_INSTALACION**: inventá una frase larga que solo sepas vos (12 caracteres o más, por ejemplo tres palabras y un número). Se usa una sola vez para crear tu cuenta de dueño.
4. Tocá **Apply**. La primera publicación tarda unos minutos.
5. Cuando diga **Live**, arriba aparece la dirección de la app: `https://plantel-3t.onrender.com` (o parecida).

## 3. Crear la cuenta del dueño

1. Abrí esa dirección en el celular.
2. Aparece "Crear cuenta del dueño": poné el código de instalación, tu nombre, tu email y una contraseña (10 caracteres o más).
3. Listo: ya entrás como dueño. Desde ese momento la instalación queda cerrada para siempre.

## 4. Instalarla en el celular

- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.
- **Android (Chrome):** menú ⋮ → **Instalar app** (o "Agregar a la pantalla principal").

Queda con el escudo como ícono y se abre como una app.

## 5. Conectar Mercado Pago (solo consulta)

La app necesita una clave para **consultar** lo que entra a tu cuenta. Mercado Pago no tiene claves "de solo lectura": esta clave técnicamente también serviría para mover plata, así que tratala como una contraseña. La app está hecha para que solo pueda consultar (ver `docs/DISENO.md`, regla 5).

1. Entrá a https://www.mercadopago.com.ar/developers con tu cuenta de Mercado Pago y andá a **Tus integraciones** → **Crear aplicación**. Ponele de nombre "3T" (si te pregunta qué vas a integrar, elegí cualquier opción de pagos online; no se usa).
2. Dentro de la aplicación, buscá **Credenciales de producción** y copiá el **Access Token** (empieza con `APP_USR-`). Si te pide activar las credenciales de producción, completá lo que pida.
3. En Render: **plantel-3t** → **Environment** → **Add Environment Variable**. En *Key* poné `MP_ACCESS_TOKEN` y en *Value* pegá el Access Token. Tocá **Save** (la app se vuelve a publicar sola en un minuto).
4. **Nunca** pegues esa clave en un chat, un mail ni en GitHub. Si alguna vez se filtra, en la misma pantalla de credenciales se puede renovar.
5. Para probar: mandate una transferencia de $1 desde otra cuenta o banco a tu alias, y en la app andá a **Ajustes** → **Mercado Pago** → **Probar conexión**.

## 6. Lectura automática de la cuenta (cada 10 minutos, gratis)

La app reconoce sola las cuotas por el DNI de quien transfiere. Para que lea la cuenta aunque nadie la abra, un servicio gratis (cron-job.org) la "despierta" cada 10 minutos. De paso, eso evita que la app se duerma.

1. **Fecha de corte:** en la app, **Ajustes → Mercado Pago → Fijar la fecha de corte**: el día desde el que tu Mercado Pago es solo del plantel. Sin esa fecha la app no lee nada.
2. **Clave secreta:** en Render → **plantel-3t** → **Environment** → **Add Environment Variable**. *Key:* `CLAVE_LECTURA`. *Value:* una frase larga inventada, de **más de 24 letras y números**, sin espacios (por ejemplo, cuatro palabras y números pegados). Guardala con **Save**. No la pegues en ningún chat.
3. Creá una cuenta gratis en **https://cron-job.org** y tocá **Create cronjob**:
   - *Title:* `3T – leer la cuenta`
   - *URL:* `https://plantel-3t.onrender.com/api/cuenta/leer`
   - *Execution schedule:* cada **10 minutos**.
   - En **Advanced**: *Request method* **POST**, y en *Headers* agregá uno con *Key* `x-clave-lectura` y *Value* la misma clave del paso 2.
   - Guardá y tocá **Test run**: tiene que responder algo como `{"estado":"LEIDA",...}`. Si responde `CLAVE_INCORRECTA`, la clave no es igual a la de Render.
4. Cuando la app se despierta puede tardar hasta un minuto: alguna ejecución puede marcar "timeout", pero la siguiente anda.

## 7. Emails de las entradas (desde plantelcuba@gmail.com, gratis)

Render, en el plan gratis, bloquea la forma clásica de mandar emails. Por eso la app los manda por la **API de Gmail**: gratis, unos 500 por día. Se hace una sola vez y lleva unos 15 minutos. En todo el paso, usá **plantelcuba@gmail.com**.

**A. Crear el proyecto en Google Cloud** (no pide tarjeta)
1. Entrá a **https://console.cloud.google.com** con plantelcuba@gmail.com y aceptá las condiciones si las pide.
2. Arriba, en el selector de proyectos → **Proyecto nuevo** → nombre `3T` → **Crear**. Dejalo seleccionado.
3. Entrá a **https://console.cloud.google.com/apis/library/gmail.googleapis.com** y tocá **Habilitar**.

**B. La pantalla de permiso**
4. Entrá a **https://console.cloud.google.com/auth/overview** → **Comenzar**.
   - Nombre de la app: `3T`. Correo de asistencia: plantelcuba@gmail.com.
   - Público: **Externo**.
   - Correo de contacto: plantelcuba@gmail.com. Aceptá y tocá **Crear**.
5. En **Acceso a los datos** → **Agregar o quitar permisos**, buscá `gmail.send`, tildalo y guardá. Es el único: la app solo puede **mandar**, no leer los emails.
6. En **Público**, tocá **Publicar app** → **Confirmar**. Así queda "En producción". Si se queda en "Prueba", Google corta la conexión cada 7 días.

**C. La llave para la app**
7. En **Clientes** → **Crear cliente**:
   - Tipo: **Aplicación web**. Nombre: `3T`.
   - En **URI de redireccionamiento autorizados** agregá exactamente:
     `https://plantel-3t.onrender.com/api/email/google/vuelta`
   - Tocá **Crear**. Google muestra un **ID de cliente** y un **Secreto del cliente**. No los pegues en ningún chat.
8. En Render → **plantel-3t** → **Environment**:
   - `GOOGLE_CLIENT_ID` = el ID de cliente.
   - `GOOGLE_CLIENT_SECRET` = el secreto.
   - `EMAIL_USUARIO` = exactamente `plantelcuba@gmail.com`.
   - Si estaba `EMAIL_CLAVE_APP`, borrala: ya no se usa.
   - Guardá con **Save** y esperá que se publique (un par de minutos).

**D. Conectar**
9. En la app: **Ajustes → Emails de las entradas → Conectar Gmail**. Entrá con plantelcuba@gmail.com.
10. Google va a decir **"Google no verificó esta app"**. Es normal: la app es tuya y no la publicás para el público. Tocá **Configuración avanzada → Ir a 3T (no seguro)** y después **Continuar**.
11. Vuelve a Ajustes con "Gmail quedó conectado". Tocá **Mandarme un email de prueba**.

Si algún día cambiás la contraseña de plantelcuba@gmail.com, Google puede cortar el permiso. Los emails quedan esperando: volvé a tocar **Volver a conectar** y salen solos. Si se filtra el secreto, en **Clientes** se crea otro y se cambia en Render.

## Para saber

- En el plan gratis, si nadie usa la app por 15 minutos, se "duerme" y el primer ingreso tarda hasta un minuto. Antes de usarla con plata real se agrega un aviso cada 14 minutos para mantenerla despierta.
- Cada vez que se aprueba un cambio en GitHub (merge a `main`), Render publica la versión nueva solo.
