# Analisis de migracion: Control Anulados

## Sistema de origen

- PHP 5-era sin framework ni Composer; la instancia del entorno actualmente ejecuta PHP 8.2. Bootstrap 3, JavaScript/jQuery, SweetAlert y CSS propio.
- Las pantallas mezclan presentacion y reglas de negocio; los permisos se verifican en PHP por sesion y perfil antes de cada accion.
- Login en MySQL `bdpersona.tbusuario`; datos de anulaciones/raspas/cartera en MySQL `GAMBLE`; consulta de formularios y raspas contra Oracle/DB links.
- El proyecto contiene paginas de captura, vistas por perfil, listados, handlers de actualizacion, informes, catalogo de causales, paginacion y shell compartido.

## Flujo y reglas que se preservan

1. `index.php` autentica el login, activa y contrasena, regenera la sesion y rechaza perfiles sin ruta en `perfiles.php`.
2. Perfiles y rutas se derivan de `perfiles.php`; los guards de cada pagina/handler comprueban la sesion y el perfil.
3. El registro consulta Oracle por serie, numero, fecha actual y zona. SERVIRED corresponde a `39628`; MULTIRED a `39627`. La escritura va a `ANULADOS_NEW_JAMUNDI` o `ANULADOS_NEW_YUMBO`.
4. `BIEN IMPRESO` exige valor minimo 6000. La hora de consulta debe ser menor que la hora final. `NO IMPRESO` queda con entrega `N` y estado pendiente.
5. `NOTA` es la causal elegida por quien registra. `OBSERVACIONES_REGISTRO` es la observacion del registro. `OBSERVACIONES_AUDITORIA` es exclusiva de auditoria. Auditoria no modifica `NOTA` ni la observacion original.
6. Comercial, contabilidad y cartera trabajan vistas/estados acotados por perfil. Auditoria SERVIRED trata pendientes entregados y Auditoria Operativa trata `NO IMPRESO`; sus decisiones quedan en historial y pueden enviarse a cobro.
7. APLICACIONES consulta raspas en Oracle y registra ventas/pagos en `VENTA_RASPA`/`PAGO_RASPA`; un codigo duplicado se rechaza. El historial normaliza los guiones de los codigos y aplica zonas distintas para ventas y pagos.
8. Los listados grandes usan paginacion; los reportes conservan sus filtros actuales de fecha/estado y exportacion.

## Tecnologia elegida

**React + TypeScript + Vite** para una SPA ligera con controles de perfil y formularios/listados interactivos. Astro esta optimizado para paginas mayormente estaticas; no aporta una ventaja suficiente para este sistema operativo y agregaria dos modelos de renderizado sin reducir el trabajo de migrar acciones autenticadas. La API separada en Node/Express concentra autenticacion, validacion, consultas parametrizadas y autorizacion. Docker Compose separa frontend, API y autenticacion V2.

## Usuarios y perfiles del SQL

El dump `sql/tbusuario.sql` crea `bdpersona.tbusuario` con `id`, `login`, `pass`, `nombre`, `perfil`, `activo` e `imei`. La relacion es directa: cada fila tiene un solo texto de perfil; no existe una tabla de permisos ni una relacion normalizada perfil-permiso. Login no tiene indice UNIQUE en el esquema heredado. El dump tiene 231 cuentas, 168 activas y 77 valores de perfil. El importador de V2 guarda todos los perfiles/usuarios, hashea las contrasenas con bcrypt y no conserva el dump ni copia la contrasena en claro.

El dump tiene 19 grupos de login repetido. El PHP heredado selecciona una fila activa con `LIMIT 1` sin orden explicito, por lo que V2 fija el primer `id` activo como cuenta autenticable y conserva las demas filas como alias inactivos `~legacy-ID`; se pueden reconciliar desde APLICACIONES. En el dry-run actual se detectan 150 cuentas autenticables por login sin colision; los 18 duplicados activos restantes requieren reconciliacion administrativa antes de habilitarse.

Distribucion agregada (cuentas / activas):

| Perfil | Total | Activos |
|---|---:|---:|
| admin | 3 | 3 |
| ADMIN | 3 | 2 |
| ADMINISTRACION | 1 | 0 |
| ADMINISTRACION_MULTIRED | 3 | 2 |
| ADMINISTRACION_SERVIRED | 1 | 1 |
| ADMINISTRACION-MULTIRED | 4 | 4 |
| ADMINISTRACION-SERVIRED | 2 | 2 |
| administrador | 4 | 4 |
| ADMINISTRADOR SERVIRED | 1 | 0 |
| ADMINITRATIVO | 1 | 1 |
| ALMACEN | 1 | 0 |
| APLICACIONES | 3 | 3 |
| Asiste Administrativo | 1 | 1 |
| Asistente Auditoria | 1 | 0 |
| asisteNte comercial | 1 | 0 |
| ASISTENTE COMERCIAL | 2 | 1 |
| ASISTENTE GH | 1 | 1 |
| ASISTENTE LOGISTICA | 1 | 0 |
| Auditoria | 2 | 0 |
| AUDITORIA | 5 | 3 |
| AUDITORIA-MULTIRED | 5 | 5 |
| AUDITORIA-OPERATIVA | 6 | 5 |
| AUDITORIA-SERVIRED | 7 | 6 |
| AUXILIAR OFICINA | 5 | 3 |
| AUXILIAR RASPAS | 2 | 2 |
| AUXILIAR TESORERIA SERVIRED | 1 | 1 |
| auxiliar-auditoria | 1 | 1 |
| AuxiliarTesoreria | 1 | 1 |
| CARTERA | 2 | 1 |
| CENTRAL_DE_SERVICIOS | 1 | 1 |
| COMERCIAL | 1 | 1 |
| COMERCIAL-MULTIRED | 9 | 7 |
| COMERCIAL-SERVIRED | 15 | 12 |
| Conductor | 1 | 1 |
| CONDUCTOR | 2 | 2 |
| CONDUCTOR COMERCIAL | 1 | 1 |
| CONDUCTOR VENDEDOR | 1 | 1 |
| CONDUCTOR-MULTIRED | 1 | 1 |
| CONDUCTORA | 1 | 1 |
| CONTABILIDAD-MULTIRED | 1 | 1 |
| CONTABILIDAD-SERVIRED | 2 | 2 |
| CONTEO | 4 | 3 |
| CONTEO_MULTIRED | 2 | 2 |
| CONTEO_SERVIRED | 5 | 4 |
| Coordinador | 1 | 1 |
| COORDINADOR | 9 | 7 |
| Coordinador Comercial | 1 | 1 |
| COORDINADOR COMERCIAL | 7 | 5 |
| COORDINADOR-LOTERIAS | 1 | 1 |
| CORDINADOR | 3 | 3 |
| CUMPLIMIENTO | 5 | 1 |
| ENTRENADOR-SERVIRED | 1 | 1 |
| ESCOLTA | 1 | 1 |
| FINANCIERO | 2 | 1 |
| gerencia | 1 | 1 |
| jefe comercial | 2 | 1 |
| LOCATIVO | 1 | 1 |
| PAP | 9 | 9 |
| PILOTO2 | 1 | 1 |
| PILOTO3 | 1 | 1 |
| RH | 1 | 1 |
| RUIZ ESCOBAR | 1 | 1 |
| SUPER NOMINARIO LOTERIA | 1 | 1 |
| SUPER NUMERARIA SERVIRED | 1 | 0 |
| SUPERIRSOR COMECIAL | 1 | 0 |
| SUPERNUMERARIO-MULTIRED | 3 | 2 |
| supervisor | 18 | 5 |
| Supervisor | 1 | 0 |
| SUPERVISOR | 18 | 8 |
| TECNICO | 11 | 11 |
| Tecnico de mantenimineto locativo | 1 | 1 |
| TECNICO DE SOPORTE | 1 | 0 |
| TECNICO-MULTIRED | 2 | 2 |
| TECNICO-SERVIRED | 4 | 4 |
| TECNOLOGIA-MULTIRED | 1 | 1 |
| TESORERA SERVIRED | 1 | 1 |
| Tesoreria | 1 | 1 |

## Permisos efectivos preservados

Los permisos siguientes provienen de los guards reales del codigo (no del nombre del perfil). Los demas perfiles del SQL se conservan como cuentas activas/inactivas pero no reciben permisos en la V2, igual que actualmente no tienen ruta autorizada.

| Perfil con acceso actual | Permisos V2 |
|---|---|
| `CENTRAL_DE_SERVICIOS` | Registrar formularios; listados SERVIRED, MULTIRED y TI; informes diarios de ambas zonas y TI |
| `TECNICO-SERVIRED` | Registrar SERVIRED; listar SERVIRED; informe diario central |
| `TECNICO-MULTIRED` | Registrar MULTIRED; listar MULTIRED; informe diario central |
| `TECNICO` | Registrar SERVIRED; listado e informe TI |
| `COORDINADOR` | Flujo TECNICO y acceso adicional al registro PDV |
| `APLICACIONES` | Consultar y registrar ventas/pagos de raspas, historial de raspas; administrar usuarios y perfiles en V2 |
| `COMERCIAL-SERVIRED` | Ver/actualizar estado de entrega; informes del dia anterior y faltantes |
| `CONTABILIDAD-SERVIRED` | Ver y registrar estado abonado/no abonado; informes autorizados y no impresos |
| `CARTERA` | Ver anulados de hoy en solo lectura; activar/desactivar usuarios de la tabla CARTERA |
| `AUDITORIA-SERVIRED` | Auditar entregados pendientes distintos de NO IMPRESO; autorizar o enviar a cobro; informe |
| `AUDITORIA-OPERATIVA` | Auditar NO IMPRESO pendiente; autorizar o enviar a cobro; informe |

## Esquema y frontera de datos

- GAMBLE conserva registros y vistas de negocio: `ANULADOS_NEW_JAMUNDI`, `ANULADOS_NEW_YUMBO`, historiales, CARTERA, causales, ventas/pagos de raspa y tablas de cobro.
- Oracle conserva la funcion de autenticacion existente y el lookup de formularios del dia.
- La V2 crea `control_anulados_v2_auth` (usuarios, perfiles y auditoria administrativa). No escribe en `bdpersona.tbusuario` ni modifica las tablas de GAMBLE/Oracle.
- Las conexiones usan secretos de entorno; no se trasladan las credenciales codificadas del PHP.
- Todas las mutaciones V2 validan perfil/permisos en API, usan parametros SQL, generan snapshots de historial y no aceptan el login del navegador como actor.