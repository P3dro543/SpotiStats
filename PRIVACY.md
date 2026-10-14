# Privacidad en SpotiStats

SpotiStats procesa datos para mostrar estadísticas a la persona que conecta su cuenta. En una instalación propia, el operador del servidor también administra la base de datos, los registros técnicos, los respaldos y las credenciales.

## Datos que almacena

- Identificador de cuenta Spotify y, si está disponible, nombre visible, país y correo devuelto por Spotify.
- Tokens OAuth de acceso y renovación cifrados con `TOKEN_ENCRYPTION_KEY`, scopes autorizados y fechas de expiración. Los tokens nunca se incluyen en las respuestas de la API de la app.
- Identificador y expiración de sesión. El navegador recibe un identificador opaco como cookie `HttpOnly`; el servidor solo almacena su HMAC.
- Registros de escucha importados o sincronizados: fecha, título, artista, álbum, duración cuando está disponible, URI, fuente y campos de contexto compatibles con el formato.
- Nombre, checksum, fechas y contadores de cada importación; resúmenes de sincronización; snapshots de afinidad de Spotify.

Los archivos subidos se procesan y no se guardan como blobs. El nombre y checksum del archivo permanecen como metadatos para deduplicación y reintentos. La API desactiva el registro de solicitudes para evitar que URL, cookies o cabeceras sensibles terminen en logs; errores inesperados se registran sin cuerpos ni tokens.

## Controles disponibles

- Descargar un archivo JSON Lines desde **Privacidad**.
- Desconectar Spotify para eliminar sus tokens y snapshots sincronizados.
- Eliminar una importación y las reproducciones asociadas.
- Eliminar la cuenta para borrar todos los datos de la aplicación asociados a esa cuenta.

La eliminación de la base activa no purga automáticamente copias históricas en respaldos del operador. El operador debe definir y cumplir una retención de copias de seguridad. SpotiStats no envía los datos a servicios de analítica publicitaria.

## Responsabilidad de quien despliega

Usa HTTPS, secretos aleatorios, una base de datos con acceso restringido, cifrado de disco/volúmenes y respaldos protegidos. No compartas `.env.production`, la clave de cifrado ni las credenciales OAuth. Los permisos pedidos a Spotify son `user-read-private`, `user-read-recently-played` y `user-top-read`; desconectar elimina los tokens almacenados, pero la gestión de permisos en Spotify se controla desde la cuenta del usuario.

Esta nota describe el comportamiento del código incluido, no reemplaza una política legal adaptada al lugar, proveedor y audiencia donde se publique la instalación.
