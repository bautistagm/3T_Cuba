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

Google no deja usar la contraseña normal de la cuenta: hay que crear una **contraseña de aplicación** (16 letras), que sirve solo para mandar emails y se puede borrar cuando quieras.

1. Entrá a **https://myaccount.google.com** con **plantelcuba@gmail.com**.
2. En **Seguridad**, activá la **Verificación en 2 pasos** (si no estaba). Sin eso, Google no muestra la opción del paso 3.
3. Entrá a **https://myaccount.google.com/apppasswords**, poné de nombre `3T` y tocá **Crear**. Google muestra 16 letras (en grupos de 4). Copialas.
4. En Render → **plantel-3t** → **Environment**, agregá dos variables:
   - `EMAIL_USUARIO` = `plantelcuba@gmail.com`
   - `EMAIL_CLAVE_APP` = las 16 letras (con o sin espacios, da igual).
   Guardá con **Save**. No pegues la clave en ningún chat.
5. En la app: **Ajustes → Emails de las entradas → Mandarme un email de prueba**. Si llega, quedó andando.

Si algún día se filtra, se borra en la misma página del paso 3 y se crea otra. Los emails que no salieron quedan pendientes y se mandan solos cuando la clave vuelve a andar.

## Para saber

- En el plan gratis, si nadie usa la app por 15 minutos, se "duerme" y el primer ingreso tarda hasta un minuto. Antes de usarla con plata real se agrega un aviso cada 14 minutos para mantenerla despierta.
- Cada vez que se aprueba un cambio en GitHub (merge a `main`), Render publica la versión nueva solo.
