# Crear la base de SpotiStats en un hosting PostgreSQL

1. En el panel del proveedor crea una base PostgreSQL vacía y un usuario de aplicación con permisos de propietario de esa base (o al menos permisos para crear tablas, índices, tipos y claves foráneas en el esquema `public`). Copia la URL de conexión que proporciona el hosting.
2. Ejecuta `spotistats.sql` una sola vez contra esa base vacía, desde el editor SQL del proveedor o con `psql`:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/spotistats.sql
   ```

   El script crea los tipos, tablas, índices y relaciones que usa Prisma. También registra la migración inicial para que `prisma migrate deploy` en el contenedor de API no vuelva a crear las tablas.
3. En las variables de entorno del servicio API configura `DATABASE_URL` con esa misma URL. Mantén la conexión privada y exige TLS si el proveedor lo admite (por ejemplo, `sslmode=require`). Si la contraseña contiene caracteres reservados en una URL, codifícala en formato percent-encoding.
4. Despliega la API. Su comando de inicio ejecutará las migraciones futuras pendientes y luego arrancará el servidor.

No ejecutes este bootstrap sobre una base que ya tenga tablas o datos. Para futuras versiones, conserva el historial de Prisma y usa `pnpm db:deploy`; no vuelvas a ejecutar el script inicial.
