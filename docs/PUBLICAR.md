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

## Para saber

- En el plan gratis, si nadie usa la app por 15 minutos, se "duerme" y el primer ingreso tarda hasta un minuto. Antes de usarla con plata real se agrega un aviso cada 14 minutos para mantenerla despierta.
- Cada vez que se aprueba un cambio en GitHub (merge a `main`), Render publica la versión nueva solo.
