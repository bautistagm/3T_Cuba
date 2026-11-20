# Cómo correr 3T en una computadora

Necesitás Node.js 22, pnpm y Docker.

```bash
pnpm install
docker compose up -d                      # base de datos local (desarrollo + tests)
cp apps/api/.env.example apps/api/.env    # configuración local
pnpm --filter @3t/api crear-dueno         # una sola vez: crea la cuenta del dueño
pnpm --filter @3t/api dev                 # levanta la API en http://localhost:3000
```

## Chequeos

```bash
pnpm check   # lint + tipos + todos los tests (los de la API usan la base "tresT_test")
```

Los mismos chequeos corren solos en GitHub con cada cambio.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `packages/shared` | Utilidades de dinero (centavos) compartidas por backend y frontend |
| `apps/api/src/db` | Esquema de la base y conexión |
| `apps/api/migraciones` | Migraciones SQL, en orden. `0001_protecciones.sql` tiene las reglas de la plata dentro de la base |
| `apps/api/src/caja` | Libro de caja: la única forma de registrar plata |
| `apps/api/src/auth`, `admins`, `auditoria` | Login, administradores y registro de auditoría |

## Cambiar la base de datos

1. Editar `apps/api/src/db/esquema.ts`.
2. `cd apps/api && npx drizzle-kit generate --name <descripcion>` genera la migración SQL.
3. Revisar el SQL generado antes de subirlo.
