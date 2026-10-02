# Paridad con el sistema legado

Comparacion pantalla por pantalla entre `controlanulados2` (PHP heredado) y la V2 (React + Express).
Cada fila indica donde el comportamiento quedo alineado y que diferencias son intencionales.

## Pantallas

| Legado | V2 | Nota |
|---|---|---|
| `index.php` | `/` (Login) | Cookie httpOnly con sesion en base de datos y deslizamiento de 30 min sin actividad |
| `buscar.php`, `buscar2.php`, `buscar-central.php` | `/register` | Mismo lookup Oracle del dia (SERVIRED 39628 / MULTIRED 39627) y misma escritura en `ANULADOS_NEW_JAMUNDI` / `ANULADOS_NEW_YUMBO` |
| `listar-servired.php` | `/records/servired` | Solo el dia actual |
| `listar-multired.php` | `/records/multired` | Solo el dia actual |
| `listar-ti.php` | `/records/ti` | Solo el dia actual |
| `listar-comercial.php` | `/records/commercial` | Pendientes de entrega `P`, excluye `NO IMPRESO` |
| `listar-contabilidad.php` | `/records/accounting` | Solo `ESTADO='AUTORIZADO'` |
| `listar-auditoria.php` | `/records/audit` | `PENDIENTE` + entregado, excluye `NO IMPRESO` |
| `listar-auditoria-operativa.php` | `/records/audit-operations` | `NO IMPRESO` pendiente y no entregado |
| `listar-cartera.php` | `/records/portfolio` | Anulados del dia en solo lectura; cartera no registra ni modifica causales |
| `Update-Cartera.php` | `/portfolio/users` | Tabla `CARTERA` con sus ocho columnas; el listado por defecto trae los registros del dia y la busqueda por usuario o empresa recorre todas las fechas |
| ventas/pagos de raspa | `/raspe` | Misma validacion de codigo, zona y duplicados |
| `historial-raspa.php` | `/raspe/history` | Normaliza guiones del codigo y separa zonas de ventas y pagos |
| `usuarios.php` | `/admin/users` | Gestion de cuentas con perfil, estado y trazabilidad |
| `perfiles.php` | `/admin/profiles` | El legado derivaba el acceso de cada pagina del nombre del perfil; la V2 usa permisos editables |
| Informes | `/reports/:report` | Mismos filtros por perfil |
| `causales.php` | `/causals` | Usa el catalogo configurado y cae a las 13 causales de la plantilla heredada |
| Cambio de clave | `/settings/password` | Verifica la clave actual y revoca las sesiones abiertas |

## Listados

Columnas visibles, en el mismo orden que el legado (18 campos; `PREMIO` existe en la tabla pero nunca se mostro):

`CODIGO`, `FECHA`, `HORA`, `SERIE`, `CONSECUTIVO`, `LOTERIA`, `HORA_FINAL`, `VALOR`, `UTILIDAD_C`, `DOCUMENTO_C`,
`NOMBRE_C`, `MOTIVO`, `HORA_CONSULTA`, `LOGIN`, `ESTADO`, `CREADOR_R`, `ESTADO_ENTREGA`, `NOTA`.

Reglas de lectura y escritura:

| Vista | Filtro por defecto | Se puede editar |
|---|---|---|
| SERVIRED / MULTIRED / TI | `FECHA = hoy` | Solo filas del dia actual |
| Comercial | `ESTADO_ENTREGA='P' AND MOTIVO<>'NO IMPRESO'` | Solo pendientes de entrega |
| Contabilidad | `ESTADO='AUTORIZADO'` | Solo autorizados |
| Auditoria | `PENDIENTE`, entregado, distinto de `NO IMPRESO` | Los mismos pendientes |
| Auditoria operativa | `NO IMPRESO`, pendiente, no entregado | Los mismos pendientes |
| Anulados de hoy (cartera) | `FECHA = hoy` | Nunca: pantalla de solo lectura |

Al escribir texto en el buscador el legado abandona el filtro de cola y alcanza cualquier registro; la V2 lo
replica con `searchWhere`, salvo en Contabilidad, donde el estado `AUTORIZADO` se mantiene siempre.
Cada limitacion de escritura se valida tambien en la API, no solo ocultando el boton en la pantalla.

## Exportaciones

El legado exportaba la pagina visible a `.xls` (contenido CSV) y anteponia un apostrofo a los valores que
empiezan por `=`, `+`, `-` o `@`. La V2 exporta la pagina actual a CSV en listados, cartera, historial de
raspas e informes, con esa misma proteccion contra formulas.

## Autenticacion y perfiles

- El legado guardaba login, perfil y nombre en la sesion PHP y rechazaba perfiles sin ruta en `perfiles.php`.
- La V2 usa `access-policy.json` como fuente de verdad: 11 perfiles de sistema, sembrados al arrancar la API
  con `INSERT IGNORE`, que no sobrescribe los permisos ya ajustados en la interfaz.
- Un perfil sin permisos deja la cuenta inutilizable porque el login exige al menos uno; la API lo rechaza con
  un mensaje que indica asignarle permisos primero, y el formulario de usuario muestra cuantos tiene cada perfil.
- Los perfiles marcados como sistema no se pueden renombrar ni eliminar desde la interfaz.

## Diferencias intencionales

- La autenticacion V2 vive en `control_anulados_v2_auth` (MariaDB) en lugar de `bdpersona.tbusuario`; las
  contrasenas se guardan con bcrypt y el dump heredado no se incluye en el repositorio.
- Los 231 usuarios del dump se importan; los 19 logins duplicados quedan como alias inactivos `~legacy-ID`
  porque el legado elegia una fila al azar con `LIMIT 1`.
- El lookup de formularios sigue leyendo Oracle, igual que el legado.
- Los perfiles sin ruta en el legado se conservan como cuentas, pero sin permisos: no existe equivalente a una
  pagina bloqueada.
- `app_sessions.expires_at` es `DATETIME` en vez de `TIMESTAMP` para que el esquema tambien se aplique en
  MariaDB con `explicit_defaults_for_timestamp` desactivado (XAMPP 10.4); el tipo es equivalente en las consultas.