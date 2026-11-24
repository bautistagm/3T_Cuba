# Backups de la base de datos

Todas las noches (a las 4:17 de Argentina) GitHub copia la base de datos, la **cifra** con una clave que solo tiene el dueño y la guarda **30 días**. Es gratis. Sin la clave, la copia no sirve para nada: ni GitHub ni nadie puede leerla.

## Configurarlo (una sola vez)

1. **Elegí una clave de backups**: una frase larga inventada, de **más de 20 letras y números**. Guardala en un lugar seguro (por ejemplo, el gestor de contraseñas de tu celular). **Si la perdés, los backups no se pueden abrir.** No la pegues en ningún chat.
2. En GitHub, en el repositorio: **Settings → Secrets and variables → Actions → New repository secret**, y creá dos:
   - `BACKUP_CLAVE`: la clave del paso 1.
   - `BACKUP_DATABASE_URL`: la misma dirección de la base que está en Render como `DATABASE_URL` (en Render: plantel-3t → Environment → `DATABASE_URL` → copiar el valor).
3. Probalo: **Actions → Backup nocturno → Run workflow**. En un minuto tiene que quedar en verde, con un archivo `3t-AAAA-MM-DD.dump.gpg` abajo de todo.

Si algún día cambia la base (por ejemplo, al arrancar con la base limpia), hay que actualizar `BACKUP_DATABASE_URL`.

## Recuperar una copia (solo si pasó algo grave)

Esto lo hace alguien con una computadora (o Claude, con ayuda del dueño). La idea es **no tocar la base que está andando**: se restaura en una base nueva y después se cambia la app a esa.

1. En GitHub: **Actions → Backup nocturno →** la noche que querés **→** descargar el archivo `.dump.gpg` (viene dentro de un .zip).
2. Descifrarlo (pide la clave de backups):
   ```sh
   gpg --decrypt 3t-AAAA-MM-DD.dump.gpg > 3t.dump
   ```
3. Crear una base nueva vacía en Neon (Neon → el proyecto → **Databases → New database**) y copiar su dirección.
4. Cargar la copia en esa base nueva:
   ```sh
   pg_restore --no-owner --no-privileges -d "DIRECCION_DE_LA_BASE_NUEVA" 3t.dump
   ```
5. En Render, cambiar `DATABASE_URL` por la dirección de la base nueva (y lo mismo en el secreto `BACKUP_DATABASE_URL` de GitHub).
6. Borrar `3t.dump` de la computadora: tiene datos personales sin cifrar.

Esto se probó el 24/11/2026: copia → cifrado → descifrado → restauración en una base nueva, con las mismas filas en todas las tablas; con una clave equivocada no se puede abrir.

## Además

Neon (plan gratis) guarda por su cuenta un historial corto que permite volver la base unas horas atrás. Los backups de GitHub son para todo lo demás.
