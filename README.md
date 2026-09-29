# Control Anulados V2

Replica independiente del sistema de control de formularios anulados. Frontend React + TypeScript + Vite, API Node.js + TypeScript/Express y MariaDB propia para usuarios, perfiles y sesiones. Los datos de negocio siguen consultando/escribiendo las tablas existentes de GAMBLE y las consultas existentes de Oracle, sin ejecutar DDL sobre esas bases.

## Funcionalidad

- Registro de anulaciones SERVIRED/MULTIRED y zona tecnica; causal, observacion, validaciones y trazabilidad.
- Listados diferenciados para central/tecnicos, TI, comercial, contabilidad, cartera, auditoria y auditoria operativa.
- Decisiones de auditoria, observacion separada, historial y envio a cobro.
- Reportes por perfil, consulta y registro de raspas, cartera y cambio de contrasena.
- Administracion de usuarios/perfiles solo para `APLICACIONES`.

## Arquitectura

- `frontend/`: SPA con rutas protegidas y menu segun perfil.
- `api/`: API versionada; valida sesion, permisos, entradas y perfiles en servidor.
- `database/`: esquema propio de usuarios y perfiles; no modifica `bdpersona`.
- `scripts/import-users.mjs`: importa el dump `tbusuario.sql` al esquema nuevo, hasheando las contrasenas durante la importacion. El dump no se copia al proyecto.
- `Jenkinsfile`, Dockerfiles y `docker-compose.yml`: build y despliegue en contenedores aislados.

Los accesos a GAMBLE y Oracle se configuran como secretos del entorno de despliegue. El sistema nuevo comparte las tablas de negocio para reflejar el mismo trabajo que el sistema anterior; los usuarios, perfiles y credenciales de V2 se mantienen en su propio esquema `control_anulados_v2_auth`.

Oracle se inicializa al primer uso para que la API y la interfaz puedan arrancar aunque Oracle no este configurado. Las consultas de formularios y raspas responderan `503` hasta que `ORACLE_USER`, `ORACLE_PASSWORD` y `ORACLE_CONNECT_STRING` tengan valores validos en el secreto de despliegue.

La base de GAMBLE debe tener aplicada la migracion existente `sql/mejoras_auditoria.sql`, que agrega `OBSERVACIONES_REGISTRO`, `OBSERVACIONES_AUDITORIA` y sus campos de trazabilidad. V2 no ejecuta esa migracion ni altera la base original. `VITE_PDV_INFO_URL` configura el enlace externo de informacion de equipos PDV para COORDINADOR; el subproyecto no viene en este repositorio.

## Perfiles

Los once perfiles con acceso actual conservan sus funciones. Los otros perfiles del dump se importan sin permisos, como hoy ocurre cuando un perfil no tiene ruta autorizada. `APLICACIONES` conserva la consulta/registro de raspa y recibe permisos adicionales para consultar/crear/editar/desactivar usuarios y gestionar perfiles. El servidor vuelve a comprobar permisos en cada ruta.

El dump actual contiene 19 grupos con login repetido (incluyendo diferencias de mayusculas/minusculas). El importador conserva todas las filas y elige como login activo la primera cuenta activa por `id`, que reproduce la consulta heredada con `LIMIT 1`; las demas filas de cada grupo se guardan inactivas con un alias `~legacy-ID` y el login original visible para que `APLICACIONES` pueda reconciliarlas. No se habilitan silenciosamente cuentas ambiguas.

## Puesta en marcha local

1. Copia `.env.example` a `.env` y completa los secretos/conexiones.
2. Instala Node.js 22+ y Docker Compose.
3. Importa una copia del dump de usuarios con `npm run import-users -- <ruta-a-tbusuario.sql>` desde `api/`.
4. Ejecuta `docker compose up --build`.
5. Abre `http://localhost:8086`.

No se incluyen usuarios, contrasenas ni credenciales reales en este repositorio. El importador lee el SQL de origen directamente y no lo conserva. Oracle Thin mode es el predeterminado; para servidores que requieran Oracle Client, coloca el Instant Client autorizado en `api/oracle-client/` y activa `DB_ORACLE_THICK_MODE`.

## Jenkins

Configura una credencial Jenkins de tipo Secret file con ID `CONTROL_ANULADOS_V2_ENV` y las variables de `.env.example`; configura el agente con Node.js 22 y Docker Compose. Se debe importar el dump de usuarios al volumen nuevo una sola vez antes de habilitar el servicio. El pipeline no importa el SQL automaticamente ni modifica `bdpersona`.

## Verificacion

En cada carpeta, ejecuta `npm install` y `npm run build`. Jenkins conserva las versiones directas fijadas en los manifiestos; cuando el agente tenga acceso al registro puede generar y versionar `package-lock.json` para builds con `npm ci`. Las pruebas de integracion requieren una base GAMBLE de pruebas y un servicio Oracle de pruebas. No uses contrasenas reales en `.env` local sin proteger el archivo.