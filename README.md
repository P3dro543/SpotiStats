# SpotiStats

Aplicación web personal para consultar afinidad de Spotify e importar el historial extendido oficial para calcular estadísticas históricas. La interfaz y la API comparten origen en el despliegue Docker; las credenciales de Spotify permanecen exclusivamente en el servidor.

## Qué incluye

- OAuth 2.0 Authorization Code en Fastify, validación de `state`, sesión rotada en cookie `HttpOnly`, protección CSRF y tokens persistentes cifrados con AES-256-GCM.
- Sincronización manual de reproducciones recientes y caché de artistas/canciones principales de Spotify.
- Importación de varios archivos JSON, validación de registros, deduplicación por evento, reintento y eliminación por lote.
- Panel con conteos, tendencias, actividad por hora y día, rankings, comparación de períodos, historial, cobertura y exportación/eliminación de datos.
- PostgreSQL y migraciones Prisma, Compose local, contenedores de frontend/API, proxy TLS con Caddy y CI de tipos, lint, pruebas y build.

Spotify no ofrece un historial ilimitado mediante su Web API. Los rankings de afinidad son propios de Spotify y sus reproducciones recientes solo cubren una ventana limitada. Las cifras históricas provienen de los JSON que tú importas. Duración y datos como `skipped` se muestran con cobertura explícita porque no todos los orígenes los incluyen.

## Requisitos

- Node.js 22.12 o posterior compatible.
- pnpm 11.9 (el repositorio fija la versión en `packageManager`).
- Docker Compose para la base local o un PostgreSQL compatible.

El flujo de instalación y scripts del repositorio usa pnpm. Actívalo con `corepack enable` si aún no está disponible.

## Desarrollo local con pnpm

1. Copia `.env.example` a `.env`. Genera valores propios para `SESSION_SECRET` y `TOKEN_ENCRYPTION_KEY`; no uses los ejemplos en un entorno real. Por ejemplo, con Node:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   El segundo valor debe representar exactamente 32 bytes. Configura `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` y el callback `http://localhost:3001/api/v1/auth/spotify/callback` en el panel de Spotify para habilitar la conexión. Sin esas credenciales la app sigue disponible para importar datos, pero conectar Spotify queda desactivado.

2. Instala dependencias y arranca PostgreSQL:

   ```powershell
   pnpm install --frozen-lockfile
   docker compose up -d postgres
   pnpm db:generate
   pnpm db:migrate
   ```

3. En dos terminales, ejecuta `pnpm dev` y `pnpm dev:web`. Abre `http://localhost:5173`; la API está en `http://localhost:3001`, salud en `/api/v1/health` y OpenAPI en `/documentation`.

## Ejecución completa con Docker

Después de configurar `.env`, ejecuta:

```powershell
docker compose up --build
```

Abre `http://localhost:8080`. El API espera PostgreSQL saludable, aplica migraciones y luego inicia. En este Compose la base usa credenciales locales fijas y solo escucha en loopback: úsalo para desarrollo, no como configuración de producción.

## Despliegue en un servidor

La opción incluida asume un servidor Linux con Docker Compose, un nombre DNS apuntando al servidor y PostgreSQL administrado con TLS/copia de seguridad. Caddy termina HTTPS automáticamente.

1. Configura `DOMAIN` y `ACME_EMAIL` en el entorno del comando Compose. Crea `.env.production` a partir de `.env.example`, con `NODE_ENV=production`, `API_PORT=3001`, `WEB_ORIGIN=https://tu-dominio`, una `DATABASE_URL` accesible desde los contenedores, secretos aleatorios propios y un callback OAuth exacto `https://tu-dominio/api/v1/auth/spotify/callback`. Spotify Client ID/Secret pueden omitirse para operar en modo importación.
2. Registra el mismo callback exacto en la configuración de Spotify. Para acceder a Spotify Web API, la cuenta debe estar autorizada por la aplicación y cumplir las reglas de acceso de Spotify vigentes.
3. Construye e inicia desde el servidor:

   ```powershell
   docker compose -f docker-compose.prod.yml up -d --build
   ```

   El proxy es el único servicio que publica puertos. No escales `api` a varias réplicas: cada arranque aplica migraciones. Usa una base con TLS, acceso de red restringido, respaldos probados y una política de actualización de secretos. Conserva `.env.production` fuera de Git y limita sus permisos.

La configuración de producción no crea un PostgreSQL local ni administra el proveedor de base de datos, DNS, cuenta de Spotify o secretos. El endpoint `/api/v1/health` es de disponibilidad del proceso, no una comprobación integral de preparación de base de datos. Verifica HTTPS, callback OAuth, importación, exportación y restauración de respaldo en el entorno objetivo antes de anunciarlo como servicio.

## Validación

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Límites y fuentes de Spotify

Solo se solicitan `user-read-private`, `user-read-recently-played` y `user-top-read`. Los eventos del endpoint reciente no incluyen duración reproducida; por eso no se inventa. Se respetan respuestas 401, 429 (`Retry-After`) y errores temporales. La disponibilidad de Spotify para aplicaciones en modo desarrollo está sujeta a cambios y a sus condiciones actuales; verifica en el [modo de cuota de Spotify](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) cuántas personas pueden autorizar la app y los requisitos de cuenta.

Referencias oficiales: [perfil actual](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile), [tops de usuarios](https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks), [reproducciones recientes](https://developer.spotify.com/documentation/web-api/reference/get-recently-played), [Authorization Code](https://developer.spotify.com/documentation/web-api/tutorials/code-flow), [renovación de tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).

Consulta [PRIVACY.md](PRIVACY.md) para el tratamiento de datos.
