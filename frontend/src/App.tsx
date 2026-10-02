import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Activity, Archive, ArrowLeft, BadgeCheck, Boxes, ClipboardList, FileBarChart, KeyRound, LogOut, Search, ShieldCheck, Users, UserRoundCog } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';

type NavEntry = { path: string; label: string; permission: string; icon: typeof Activity };

/* Mismas columnas y rotulos que mostraban los listados del sistema legado.
   PREMIO existe en la tabla pero nunca se mostro en pantalla. */
const recordColumns: Array<{ column: string; label: string }> = [
  { column: 'CODIGO', label: 'Codigo' },
  { column: 'FECHA', label: 'Fecha form.' },
  { column: 'HORA', label: 'Hora form.' },
  { column: 'SERIE', label: 'Serie' },
  { column: 'CONSECUTIVO', label: 'Consecutivo' },
  { column: 'LOTERIA', label: 'Loteria' },
  { column: 'HORA_FINAL', label: 'Hora final' },
  { column: 'VALOR', label: 'Valor' },
  { column: 'UTILIDAD_C', label: 'Utilidad' },
  { column: 'DOCUMENTO_C', label: 'Documento col.' },
  { column: 'NOMBRE_C', label: 'Nombre col.' },
  { column: 'MOTIVO', label: 'Motivo' },
  { column: 'HORA_CONSULTA', label: 'Hora consulta' },
  { column: 'LOGIN', label: 'Login motivo' },
  { column: 'ESTADO', label: 'Estado sol.' },
  { column: 'CREADOR_R', label: 'Creador' },
  { column: 'ESTADO_ENTREGA', label: 'Estado entrega' },
  { column: 'NOTA', label: 'Causal' },
];

const recordDetailFields = [
  ...recordColumns.map((item) => item.column),
  'OBSERVACIONES_REGISTRO', 'OBSERVACIONES_AUDITORIA', 'USUARIO_AUDITORIA', 'FECHA_ACTUALIZACION',
];

/* Catalogo por defecto identico al de causales.php, usado cuando
   CAUSALES_ANULACION no esta disponible. */
const defaultCausals = [
  'Error en el valor del formulario', 'Error en el numero de serie', 'Error en la loteria',
  'Formulario impreso en papel blanco', 'Impresion incompleta (termino de rollo)', 'Serie ilegible',
  'Informacion remontada', 'Informacion incompleta', 'No imprimio la serie',
  'Formulario no llego fisico', 'Formulario cortado o danado', 'Impreso en lapiz', 'Otros',
];

/* El legado exportaba un .xls y anteponia un apostrofo a los valores que
   empiezan por = + - @ para que la hoja de calculo no los ejeculte. */
function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  if (rows.length === 0) return;
  const lines = [headers.map(csvCell).join(';'), ...rows.map((line) => line.map(csvCell).join(';'))];
  const url = URL.createObjectURL(new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const navigation: NavEntry[] = [
  { path: '/register', label: 'Registrar anulacion', permission: 'forms:register', icon: Boxes },
  { path: '/records/servired', label: 'Formularios SERVIRED', permission: 'records:central', icon: Archive },
  { path: '/records/multired', label: 'Formularios MULTIRED', permission: 'records:central', icon: Archive },
  { path: '/records/ti', label: 'Control TI', permission: 'records:ti', icon: ClipboardList },
  { path: '/records/audit', label: 'Auditoria', permission: 'records:audit', icon: ShieldCheck },
  { path: '/records/audit-operations', label: 'Auditoria operativa', permission: 'records:audit-operations', icon: ShieldCheck },
  { path: '/records/commercial', label: 'Comercial', permission: 'records:commercial', icon: ClipboardList },
  { path: '/records/accounting', label: 'Contabilidad', permission: 'records:accounting', icon: ClipboardList },
  { path: '/records/portfolio', label: 'Anulados de hoy', permission: 'records:portfolio', icon: Archive },
  { path: '/portfolio/users', label: 'Usuarios de cartera', permission: 'portfolio:manage', icon: Users },
  { path: '/raspe', label: 'Consulta de raspas', permission: 'raspe:search', icon: Search },
  { path: '/raspe/history', label: 'Ventas y pagos raspa', permission: 'raspe:search', icon: FileBarChart },
  { path: '/reports/central-servired', label: 'Reporte diario SERVIRED', permission: 'reports:central', icon: FileBarChart },
  { path: '/reports/central-multired', label: 'Reporte diario MULTIRED', permission: 'reports:central', icon: FileBarChart },
  { path: '/reports/ti', label: 'Reporte diario TI', permission: 'reports:ti', icon: FileBarChart },
  { path: '/reports/commercial-yesterday', label: 'Reporte comercial', permission: 'reports:commercial', icon: FileBarChart },
  { path: '/reports/commercial-missing', label: 'Faltantes de anulados', permission: 'reports:commercial', icon: FileBarChart },
  { path: '/reports/accounting', label: 'Reporte contable', permission: 'reports:accounting', icon: FileBarChart },
  { path: '/reports/accounting-no-print', label: 'Contabilidad no impresos', permission: 'reports:accounting', icon: FileBarChart },
  { path: '/reports/audit', label: 'Reporte de auditoria', permission: 'reports:audit', icon: FileBarChart },
  { path: '/reports/audit-no-print', label: 'Auditoria no impresos', permission: 'reports:audit-operations', icon: FileBarChart },
  { path: '/users', label: 'Usuarios', permission: 'users:manage', icon: UserRoundCog },
  { path: '/profiles', label: 'Perfiles', permission: 'profiles:manage', icon: BadgeCheck },
];

function Login() {
  const { signIn } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await signIn(String(data.get('username')), String(data.get('password')));
      navigate('/', { replace: true });
    } catch (requestError) {
      const message = (requestError as { response?: { data?: { message?: string } } }).response?.data?.message;
      setError(message ?? 'No fue posible iniciar sesion. Verifica tu conexion.');
    } finally { setBusy(false); }
  };
  return <main className="login-page">
    <section className="login-panel">
      <div className="login-kicker"><span className="status-dot" /> SERVIRED / OPERACIONES</div>
      <h1>Control<br /><em>Anulados</em></h1>
      <p>Registro y seguimiento de formularios por zona.</p>
      <form onSubmit={submit} className="login-form">
        <label>Usuario<input name="username" autoComplete="username" required autoFocus /></label>
        <label>Contrasena<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? 'Validando...' : 'Ingresar'}<ArrowLeft size={17} /></button>
      </form>
      <small className="login-foot">ACCESO POR PERFIL · SESION PROTEGIDA</small>
    </section>
    <aside className="login-aside">
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <span className="aside-index">01 / 04</span>
      <div className="aside-copy"><span>GESTION OPERATIVA</span><h2>La trazabilidad<br />empieza aqui.</h2><p>Seguimiento de anulaciones, decisiones y movimientos en un solo lugar.</p></div>
      <div className="aside-line"><span>39628</span><span>SERVIRED</span><span>39627</span><span>MULTIRED</span></div>
    </aside>
  </main>;
}

function Shell() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const links = navigation.filter((item) => user?.permissions.includes(item.permission));
  const active = links.find((item) => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" to="/"><span className="brand-mark">CA</span><span>Control<span>Anulados</span></span></Link>
      <div className="sidebar-section">OPERACION</div>
      <nav className="side-nav">{links.map((item) => {
        const Icon = item.icon;
        return <Link key={item.path} to={item.path} className={active?.path === item.path ? 'side-link selected' : 'side-link'}><Icon size={17} /><span>{item.label}</span></Link>;
      })}</nav>
      {user?.permissions.includes('forms:pdv') && import.meta.env.VITE_PDV_INFO_URL && <a className="side-link" href={import.meta.env.VITE_PDV_INFO_URL} target="_blank" rel="noreferrer"><Boxes size={17} /><span>Informacion equipos PDV</span></a>}
      {user?.permissions.includes('records:portfolio') && <div className="side-note"><span className="status-dot" /> SERVICIO ACTIVO</div>}
      <button className="side-logout" onClick={() => void signOut()}><LogOut size={17} /> Cerrar sesion</button>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">CONTROL / <strong>{active?.label ?? 'Inicio'}</strong></div><div className="profile-chip"><span className="avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span><span><strong>{user?.displayName}</strong><small>{user?.profile}</small></span><button title="Cambiar contrasena" onClick={() => navigate('/password')}><KeyRound size={16} /></button></div></header>
      <div className="page-content"><Routes>
        <Route path="/" element={<Home links={links} />} />
        <Route path="/register" element={<Guard permission="forms:register"><Register /></Guard>} />
        <Route path="/records/:view" element={<Records />} />
        <Route path="/portfolio/users" element={<Guard permission="portfolio:manage"><Portfolio /></Guard>} />
        <Route path="/raspe" element={<Guard permission="raspe:search"><Raspe /></Guard>} />
        <Route path="/raspe/history" element={<Guard permission="raspe:search"><RaspeHistory /></Guard>} />
        <Route path="/users" element={<Guard permission="users:manage"><UsersPage /></Guard>} />
        <Route path="/profiles" element={<Guard permission="profiles:manage"><ProfilesPage /></Guard>} />
        <Route path="/password" element={<ChangePassword />} />
        <Route path="/reports/:report" element={<ReportsRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes></div>
      <footer className="page-footer"><span>CONTROL ANULADOS / V2</span><span>GESTION POR PERFILES</span></footer>
    </main>
  </div>;
}

function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  return user?.permissions.includes(permission) ? children : <NotFound />;
}

function Home({ links }: { links: NavEntry[] }) {
  return <section className="home-view"><div className="eyebrow">PANEL DE OPERACION <span> / {new Date().toLocaleDateString('es-CO')}</span></div><h1>Buen dia.<br /><em>Que necesitas gestionar?</em></h1><p className="lede">Accede a las funciones habilitadas para tu perfil.</p><div className="home-links">{links.map((item, index) => { const Icon = item.icon; return <Link to={item.path} className="home-link" key={item.path}><span className="home-link-index">0{index + 1}</span><Icon size={20} /><strong>{item.label}</strong><ArrowLeft className="home-arrow" size={18} /></Link>; })}</div></section>;
}

interface OracleForm { FECHA: string; HORA: string; SERIE_KARDEX: string; CONSECUTIVO: string; NOMBRECORTO: string; HORAFINALVENTA: string; TOTALPAGADO: number; UTILIDAD: number; DOCUMENTO_VENDEDOR: string; VENDEDOR: string; HORA_CONSULTA: string; zona: number }

function Register() {
  const { user } = useAuth();
  const [form, setForm] = useState<OracleForm | null>(null);
  const [causals, setCausals] = useState<string[]>([]);
  const [zone, setZone] = useState(user?.profile === 'TECNICO-MULTIRED' ? 39627 : 39628);
  const [lookup, setLookup] = useState({ serie: '', numero: '' });
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const canSelectZone = ['CENTRAL_DE_SERVICIOS', 'TECNICO-SERVIRED', 'TECNICO-MULTIRED'].includes(user?.profile ?? '');
  useEffect(() => { void api.get<string[]>('/causals').then((result) => setCausals(result.data)).catch(() => setCausals(defaultCausals)); }, []);
  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setFeedback(''); setForm(null);
    try { const input = { serie: String(data.get('serie')), numero: String(data.get('numero')) }; const result = await api.post<OracleForm>('/forms/search', { ...input, zona: zone }); setLookup(input); setForm(result.data); }
    catch (requestError) { setFeedback((requestError as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No se pudo consultar Oracle.'); }
    finally { setBusy(false); }
  };
  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!form) return;
    const data = new FormData(event.currentTarget); setBusy(true); setFeedback('');
    try { await api.post('/forms', { ...lookup, zona: form.zona, motivo: data.get('motivo'), nota: data.get('nota'), observacionesRegistro: data.get('observacionesRegistro') }); setFeedback('Formulario registrado correctamente.'); setForm(null); }
    catch (requestError) { setFeedback((requestError as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No se pudo registrar.'); }
    finally { setBusy(false); }
  };
  return <section><PageHeading eyebrow="CAPTURA" title="Registrar anulacion" description="Consulta el formulario del dia y registra el motivo correspondiente." />
    <form className="filter-bar" onSubmit={search}>
      {canSelectZone && <label>Zona<select value={zone} onChange={(event) => setZone(Number(event.target.value))}><option value={39628}>SERVIRED</option><option value={39627}>MULTIRED</option></select></label>}
      <label>Serie<input name="serie" required maxLength={10} /></label><label>Numero<input name="numero" required inputMode="numeric" pattern="[0-9]{1,10}" /></label>
      <button className="button button-primary" disabled={busy}><Search size={16} />{busy ? 'Consultando' : 'Consultar'}</button>
    </form>
    {feedback && <p className="notice">{feedback}</p>}
    {form && <div className="record-detail"><div className="detail-top"><div><span className="eyebrow">FORMULARIO ENCONTRADO</span><h2>{form.SERIE_KARDEX}</h2></div><span className="tag">{form.zona === 39627 ? 'MULTIRED' : 'SERVIRED'}</span></div><div className="detail-grid">{[['Fecha',form.FECHA],['Hora',form.HORA],['Consecutivo',form.CONSECUTIVO],['Loteria',form.NOMBRECORTO],['Valor',form.TOTALPAGADO],['Vendedor',form.VENDEDOR],['Documento',form.DOCUMENTO_VENDEDOR],['Hora final',form.HORAFINALVENTA]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <form className="record-form" onSubmit={submitRecord}><label>Motivo<select name="motivo"><option>EN BLANCO</option><option>BIEN IMPRESO</option><option>MAL IMPRESO</option><option>NO IMPRESO</option></select></label><label>Causal de anulacion<select name="nota" required><option value="">Selecciona una causal</option>{causals.map((causal) => <option key={causal}>{causal}</option>)}</select></label><label className="wide-field">Observacion del registro<textarea name="observacionesRegistro" rows={3} maxLength={4000} /></label><button className="button button-primary" disabled={busy}>Registrar formulario</button></form>
    </div>}
  </section>;
}

function Records() {
  const { view = '' } = useParams();
  const { user } = useAuth();
  const recordPermission: Record<string, string> = { servired: 'records:central', multired: 'records:central', ti: 'records:ti', audit: 'records:audit', 'audit-operations': 'records:audit-operations', commercial: 'records:commercial', accounting: 'records:accounting', portfolio: 'records:portfolio' };
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [notice, setNotice] = useState('');
  const title = navigation.find((item) => item.path === `/records/${view}`)?.label ?? 'Registros';
  if (!user?.permissions.includes(recordPermission[view] ?? '')) return <NotFound />;
  const load = async (targetPage = page) => {
    try { const result = await api.get<{ rows: Array<Record<string, unknown>>; total: number }>(`/records/${view}`, { params: { q, page: targetPage, limit: 50, ...(view === 'audit' && dateFrom && dateTo ? { dateFrom, dateTo } : {}) } }); setRows(result.data.rows); setTotal(result.data.total); setPage(targetPage); }
    catch { setNotice('No fue posible cargar los registros.'); }
  };
  useEffect(() => { void load(); }, [view]);
  const exportPage = () => downloadCsv(`anulados-${view}.csv`, recordColumns.map((item) => item.label), rows.map((row) => recordColumns.map((item) => row[item.column])));
  const saveAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const data = new FormData(event.currentTarget);
    const serie = String(selected.SERIE ?? '');
    try {
      if (view === 'audit') await api.patch(`/records/${encodeURIComponent(serie)}/audit`, { state: data.get('state'), observacionesAuditoria: data.get('observacionesAuditoria') });
      else if (view === 'audit-operations') await api.patch(`/records/${encodeURIComponent(serie)}/audit-operations`, { state: data.get('state'), observacionesAuditoria: data.get('observacionesAuditoria') });
      else if (view === 'commercial') await api.patch(`/records/${encodeURIComponent(serie)}/commercial`, { estadoEntrega: data.get('estadoEntrega') });
      else if (view === 'accounting') await api.patch(`/records/${encodeURIComponent(serie)}/accounting`, { state: data.get('state') });
      else await api.patch(`/records/${view === 'multired' ? 39627 : 39628}/${encodeURIComponent(serie)}/technical`, { motivo: data.get('motivo'), nota: data.get('nota') });
      setSelected(null); setNotice('Cambios guardados.'); await load();
    } catch (requestError) { setNotice((requestError as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No se pudieron guardar los cambios.'); }
  };
  return <section><PageHeading eyebrow="CONSULTA Y SEGUIMIENTO" title={title} description="Registros disponibles segun tu perfil." />
    <form className="filter-bar compact" onSubmit={(event) => { event.preventDefault(); void load(1); }}>{view === 'audit' && <><label>Desde<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>Hasta<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></>}<label>Buscar<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Serie, documento, nombre o motivo" /></label><button className="button button-light"><Search size={16} />Buscar</button><button type="button" className="button button-light" onClick={() => void load()}><Activity size={16} />Actualizar</button><button type="button" className="button button-light" onClick={exportPage} disabled={rows.length === 0}><FileBarChart size={16} />Exportar pagina</button></form>
    {notice && <p className="notice">{notice}</p>}
    <div className="table-wrap"><table><thead><tr>{recordColumns.map((item) => <th key={item.column}>{item.label}</th>)}{view !== 'portfolio' && <th>Accion</th>}</tr></thead><tbody>{rows.map((row,index) => { const today = new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date()); const canEdit = view !== 'portfolio' && (!['servired','multired','ti'].includes(view) || row.FECHA === today); return <tr key={`${row.CODIGO}-${index}`}>{recordColumns.map((item) => <td key={item.column}>{String(row[item.column] ?? '')}</td>)}{view !== 'portfolio' && <td>{canEdit ? <button className="table-action" onClick={() => setSelected(row)}>Abrir</button> : <span className="state">Solo lectura</span>}</td>}</tr>; })}{rows.length === 0 && <tr><td colSpan={recordColumns.length + (view === 'portfolio' ? 0 : 1)} className="empty-cell">No hay registros para mostrar.</td></tr>}</tbody></table></div>
    <div className="pager"><span>{total} registros · pagina {page}</span><div><button className="button button-light" disabled={page <= 1} onClick={() => void load(page - 1)}>Anterior</button><button className="button button-light" disabled={page * 50 >= total} onClick={() => void load(page + 1)}>Siguiente</button></div></div>
    {selected && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><form className="dialog-panel" onSubmit={saveAction}><div className="dialog-head"><div><span className="eyebrow">SERIE</span><h2>{String(selected.SERIE ?? '')}</h2></div><button type="button" className="icon-button" onClick={() => setSelected(null)}>×</button></div><div className="detail-grid">{recordDetailFields.filter((key) => selected[key] !== undefined && selected[key] !== null && String(selected[key] ?? '') !== '').map((key) => <div key={key}><span>{key.replaceAll('_',' ')}</span><strong>{String(selected[key] ?? '')}</strong></div>)}</div>
      {view.startsWith('audit') ? <><label>Observacion de auditoria<textarea name="observacionesAuditoria" rows={4} required /></label><label>Decision<select name="state"><option value="AUTORIZADO">Autorizado</option><option value="COBRAR">Enviar a cobro</option></select></label></> : view === 'commercial' ? <label>Estado de entrega<select name="estadoEntrega"><option value="S">Recibido</option><option value="N">No recibido</option></select></label> : view === 'accounting' ? <label>Estado contable<select name="state"><option value="ABONADO">Abonado</option><option value="NO ABONADO">No abonado</option></select></label> : <><label>Motivo<select name="motivo"><option>EN BLANCO</option><option>BIEN IMPRESO</option><option>MAL IMPRESO</option><option>NO IMPRESO</option></select></label><label>Causal<input name="nota" defaultValue={String(selected.NOTA ?? '')} required /></label></>}
      <button className="button button-primary">Guardar decision</button></form></div>}
  </section>;
}

function formatRaspeDate(value: unknown) {
  const raw = String(value ?? '');
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function formatRaspeTime(value: unknown) {
  const raw = String(value ?? '');
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
}

function Raspe() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ sales: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> }>({ sales: [], payments: [] });
  const [notice, setNotice] = useState('');
  const search = async (event: FormEvent) => { event.preventDefault(); try { const response = await api.get('/raspe/search', { params: { code } }); setResult(response.data); setNotice(''); } catch { setNotice('No se pudo consultar el codigo.'); } };
  const save = async (type: 'sale' | 'payment', row: Record<string, unknown>) => {
    const date = formatRaspeDate(row.FECHAVENTA ?? row.FECHAPAGO);
    const time = formatRaspeTime(row.HORAVENTA ?? row.HORAPAGO);
    try {
      await api.post('/raspe', type === 'sale'
        ? { type, code: row.CODIGOVENTA, date, time, value: row.VALOR, vendor: row.VENDEDOR, company: row.EMPRESA, zone: row.ZONA }
        : { type, code: row.CODIGOVENTA, date, time, prize: row.TOTALPREMIO, cashier: row.CAJERO, zoneName: row.NOMBRE_ZONA, zone: row.ZONA });
      setNotice(type === 'sale' ? 'Venta registrada.' : 'Pago registrado.');
    } catch (error) { setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No se pudo registrar.'); }
  };
  return <section><PageHeading eyebrow="APLICACIONES" title="Consulta de raspas" description="Verifica ventas y pagos; registra la operacion despues de confirmar." /><form className="filter-bar" onSubmit={search}><label>Codigo de raspado<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="00000-000000-0000-0" required /></label><button className="button button-primary"><Search size={16} />Consultar</button></form>{notice && <p className="notice">{notice}</p>}{[['Ventas',result.sales,'sale'],['Pagos',result.payments,'payment']].map(([title, items, type]) => <section className="table-section" key={String(title)}><h2>{String(title)}</h2><div className="table-wrap"><table><thead><tr>{(items as Array<Record<string,unknown>>)[0] ? Object.keys((items as Array<Record<string,unknown>>)[0]).map((key) => <th key={key}>{key}</th>) : <th>Resultado</th>}<th>Accion</th></tr></thead><tbody>{(items as Array<Record<string,unknown>>).map((row,index) => <tr key={index}>{Object.keys(row).map((key) => <td key={key}>{String(row[key] ?? '')}</td>)}<td><button className="table-action" onClick={() => void save(type as 'sale'|'payment', row)}>Registrar</button></td></tr>)}</tbody></table></div></section>)}</section>;
}

function RaspeHistory() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ sales: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> }>({ sales: [], payments: [] });
  const [notice, setNotice] = useState('');
  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try { const response = await api.get('/raspe/history', { params: { code } }); setResult(response.data); setNotice(''); }
    catch { setNotice('No fue posible consultar el historial.'); }
  };
  const exportRaspe = (kind: string, items: Array<Record<string, unknown>>) => {
    const headers = items[0] ? Object.keys(items[0]) : [];
    downloadCsv(`raspas-${kind}.csv`, headers, items.map((row) => headers.map((header) => row[header])));
  };
  return <section><PageHeading eyebrow="APLICACIONES" title="Ventas y pagos de raspa" description="Busca operaciones registradas por código y zona."/><form className="filter-bar" onSubmit={search}><label>Código de raspa<input value={code} onChange={(event)=>setCode(event.target.value)} placeholder="39628-..." required /></label><button className="button button-primary"><Search size={16}/>Buscar</button><button type="button" className="button button-light" disabled={result.sales.length === 0} onClick={() => exportRaspe('vendidos', result.sales)}><FileBarChart size={16}/>Exportar ventas</button><button type="button" className="button button-light" disabled={result.payments.length === 0} onClick={() => exportRaspe('pagados', result.payments)}><FileBarChart size={16}/>Exportar pagos</button></form>{notice&&<p className="notice">{notice}</p>}{[['Ventas',result.sales],['Pagos',result.payments]].map(([title,items])=><section className="table-section" key={String(title)}><h2>{String(title)}</h2><div className="table-wrap"><table><thead><tr>{(items as Array<Record<string,unknown>>)[0]?Object.keys((items as Array<Record<string,unknown>>)[0]).map((key)=><th key={key}>{key}</th>):<th>Sin resultados</th>}</tr></thead><tbody>{(items as Array<Record<string,unknown>>).map((row,index)=><tr key={index}>{Object.keys(row).map((key)=><td key={key}>{String(row[key]??'')}</td>)}</tr>)}</tbody></table></div></section>)}</section>;
}

function Portfolio() {
  const portfolioColumns = ['USUARIO', 'CARTERA', 'SALDO', 'ESTADO', 'LOGIN', 'EMPRESA', 'FECHASYS', 'VERSION'];
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    try { const result = await api.get<{ rows: Array<Record<string,unknown>> }>('/portfolio', { params: { q: query } }); setRows(result.data.rows); setNotice(''); }
    catch (error) { setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No fue posible consultar los usuarios de cartera.'); }
  };
  const toggle = async (row: Record<string, unknown>) => {
    try { await api.patch(`/portfolio/${encodeURIComponent(String(row.USUARIO))}`, { active: row.ESTADO === 'S' ? 'N' : 'S' }); await load(); }
    catch (error) { setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No fue posible actualizar el usuario de cartera.'); }
  };
  useEffect(() => { void load(); }, []);
  return <section><PageHeading eyebrow="CARTERA" title="Usuarios de cartera" description="Consulta y habilita usuarios de cartera." /><form className="filter-bar compact" onSubmit={(event) => { event.preventDefault(); void load(); }}><label>Usuario o empresa<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button button-primary"><Search size={16} />Buscar</button><button type="button" className="button button-light" disabled={rows.length === 0} onClick={() => downloadCsv('cartera.csv', portfolioColumns, rows.map((row) => portfolioColumns.map((key) => row[key])))}><FileBarChart size={16} />Exportar CSV</button></form>{notice && <p className="notice">{notice}</p>}<div className="table-wrap"><table><thead><tr>{portfolioColumns.map((key) => <th key={key}>{key}</th>)}<th>Accion</th></tr></thead><tbody>{rows.map((row,index) => <tr key={index}>{portfolioColumns.map((key) => <td key={key}>{String(row[key] ?? '')}</td>)}<td><button className="table-action" onClick={() => void toggle(row)}>{row.ESTADO === 'S' ? 'Desactivar' : 'Activar'}</button></td></tr>)}{rows.length === 0 && <tr><td colSpan={portfolioColumns.length + 1} className="empty-cell">No hay usuarios de cartera para mostrar.</td></tr>}</tbody></table></div><div className="pager"><span>Consulta de solo lectura: cartera no registra ni modifica causales.</span></div></section>;
}

function UsersPage() {
  const [users, setUsers] = useState<Array<Record<string, unknown> & { legacyLogin?: string | null }>>([]);
  const [profiles, setProfiles] = useState<Array<{ id: number; name: string; permissions: string[] }>>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<(Record<string, unknown> & { legacyLogin?: string | null }) | null>(null);
  const [notice, setNotice] = useState('');
  const load = async () => { try { const [u,p] = await Promise.all([api.get('/admin/users', { params: { q: query } }), api.get('/admin/profiles')]); setUsers(u.data); setProfiles(p.data); setNotice(''); } catch { setNotice('No fue posible cargar los usuarios.'); } };
  useEffect(() => { void load(); }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const body: Record<string,unknown> = { username: data.get('username'), displayName: data.get('displayName'), profileId: Number(data.get('profileId')), active: data.get('active') === '1' };
    const password = String(data.get('password') ?? ''); if (password) body.password = password;
    try { if (editing?.id) await api.patch(`/admin/users/${editing.id}`, { username: body.username, displayName: body.displayName, profileId: body.profileId, active: body.active, ...(password ? { password } : {}) }); else await api.post('/admin/users', body); setEditing(null); setNotice('Usuario guardado.'); await load(); }
    catch (error) { setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No se pudo guardar el usuario.'); }
  };
  return <section><PageHeading eyebrow="ADMINISTRACION / APLICACIONES" title="Usuarios" description="Cuentas y perfiles de acceso. Las contrasenas nunca se muestran." /><div className="filter-bar compact"><label>Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="button button-light" onClick={() => void load()}><Search size={16} />Buscar</button><button className="button button-primary" onClick={() => setEditing({})}>Nuevo usuario</button></div>{notice && <p className="notice">{notice}</p>}<div className="table-wrap"><table><thead><tr><th>Usuario V2</th><th>Login legado</th><th>Nombre</th><th>Perfil</th><th>Estado</th><th>Origen</th><th></th></tr></thead><tbody>{users.map((user) => <tr key={String(user.id)}><td>{String(user.username)}</td><td>{String(user.legacyLogin ?? '')}</td><td>{String(user.displayName)}</td><td><span className="tag">{String(user.profile)}</span></td><td><span className={user.active ? 'state state-on' : 'state state-off'}>{user.active ? 'Activo' : 'Inactivo'}</span></td><td>{user.legacyId ? 'Importado' : 'Local'}</td><td><button className="table-action" onClick={() => setEditing({ ...user, active: Boolean(user.active) })}>Editar</button></td></tr>)}</tbody></table></div>{editing && <div className="overlay"><form className="dialog-panel" onSubmit={save}><div className="dialog-head"><div><span className="eyebrow">GESTION DE CUENTA</span><h2>{editing.id ? 'Editar usuario' : 'Crear usuario'}</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)}>×</button></div><label>Usuario<input name="username" defaultValue={String(editing.username ?? '')} required /></label>{editing.legacyLogin && <p className="notice">Login de origen: {String(editing.legacyLogin)}. Las colisiones importadas quedan inactivas hasta ser revisadas.</p>}<label>Nombre<input name="displayName" defaultValue={String(editing.displayName ?? '')} required /></label><label>Perfil<select name="profileId" defaultValue={String(editing.profileId ?? profiles[0]?.id ?? '')}>{profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={profile.permissions.length === 0}>{profile.name}{profile.permissions.length === 0 ? ' (sin permisos)' : ` (${profile.permissions.length})`}</option>)}</select></label><label>Contrasena<input name="password" type="password" minLength={8} required={!editing.id} autoComplete="new-password" /></label><label>Estado<select name="active" defaultValue={editing.active === false ? '0' : '1'}><option value="1">Activo</option><option value="0">Inactivo</option></select></label><button className="button button-primary">Guardar usuario</button></form></div>}</section>;
}

function ProfilesPage() {
  const [profiles, setProfiles] = useState<Array<{id:number;name:string;permissions:string[];isSystem:boolean}>>([]);
  const [editing, setEditing] = useState<{id?:number;name:string;permissions:string[]}>({ name:'', permissions:[] });
  const [notice, setNotice] = useState('');
  const availablePermissions = ['forms:register','forms:pdv','records:central','records:ti','records:commercial','records:update:commercial','reports:commercial','reports:central','reports:ti','records:accounting','records:update:accounting','reports:accounting','records:audit','records:update:audit','reports:audit','records:audit-operations','records:update:audit-operations','reports:audit-operations','records:portfolio','portfolio:manage','raspe:search','raspe:write','users:manage','profiles:manage'];
  const load = async () => { const result = await api.get('/admin/profiles'); setProfiles(result.data); };
  useEffect(() => { void load(); }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); try { const payload={name:editing.name,permissions:editing.permissions}; if(editing.id) await api.patch(`/admin/profiles/${editing.id}`,payload); else await api.post('/admin/profiles',payload); setNotice('Perfil guardado.'); setEditing({name:'',permissions:[]}); await load(); } catch(error) { setNotice((error as {response?:{data?:{message?:string}}}).response?.data?.message ?? 'No se pudo guardar.'); } };
  return <section><PageHeading eyebrow="ADMINISTRACION / APLICACIONES" title="Perfiles" description="Define el acceso por funciones. Los privilegios administrativos son exclusivos de APLICACIONES." />{notice && <p className="notice">{notice}</p>}<div className="profile-layout"><div className="profile-list">{profiles.map((profile) => <button key={profile.id} className="profile-row" onClick={() => setEditing({id:profile.id,name:profile.name,permissions:profile.permissions})}><span><strong>{profile.name}</strong><small>{profile.permissions.length} permisos {profile.isSystem ? '· sistema' : ''}</small></span><ArrowLeft size={17}/></button>)}</div><form className="profile-editor" onSubmit={save}><span className="eyebrow">{editing.id ? 'EDITAR' : 'NUEVO'}</span><label>Nombre del perfil<input value={editing.name} disabled={profiles.find((profile)=>profile.id===editing.id)?.isSystem} onChange={(event)=>setEditing({...editing,name:event.target.value})} minLength={2} required /></label><fieldset><legend>Permisos</legend>{availablePermissions.map((permission)=><label className="permission-check" key={permission}><input type="checkbox" checked={editing.permissions.includes(permission)} onChange={(event)=>setEditing({...editing,permissions:event.target.checked?[...editing.permissions,permission]:editing.permissions.filter((item)=>item!==permission)})}/><span>{permission}</span></label>)}</fieldset><div className="button-row"><button className="button button-primary">Guardar perfil</button>{editing.id && !profiles.find((profile)=>profile.id===editing.id)?.isSystem && <button type="button" className="button button-danger" onClick={async()=>{try{await api.delete(`/admin/profiles/${editing.id}`);setEditing({name:'',permissions:[]});await load();}catch(error){setNotice((error as {response?:{data?:{message?:string}}}).response?.data?.message ?? 'No se pudo eliminar.');}}}>Eliminar</button>}<button type="button" className="button button-light" onClick={()=>setEditing({name:'',permissions:[]})}>Nuevo</button></div></form></div></section>;
}

function ChangePassword() {
  const { signOut } = useAuth();
  const [notice, setNotice] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const currentPassword=String(data.get('currentPassword')); const newPassword=String(data.get('newPassword')); if(newPassword!==data.get('confirmPassword')) { setNotice('Las contrasenas nuevas no coinciden.'); return; } try { await api.post('/change-password',{currentPassword,newPassword}); await signOut(); } catch(error) { setNotice((error as {response?:{data?:{message?:string}}}).response?.data?.message ?? 'No se pudo actualizar.'); } };
  return <section><PageHeading eyebrow="CUENTA" title="Cambiar contrasena" description="La contrasena se almacena cifrada en el sistema V2."/><form className="settings-form" onSubmit={submit}><label>Contrasena actual<input name="currentPassword" type="password" required/></label><label>Nueva contrasena<input name="newPassword" type="password" minLength={8} required/></label><label>Confirmar contrasena<input name="confirmPassword" type="password" minLength={8} required/></label>{notice&&<p className="notice">{notice}</p>}<button className="button button-primary">Actualizar</button></form></section>;
}

function PageHeading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) { return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>; }
function NotFound() { return <section className="not-found"><span className="eyebrow">404 / SIN ACCESO</span><h1>Esta vista no esta disponible.</h1><Link to="/">Volver al inicio</Link></section>; }

function ReportsData() {
  const { report = '' } = useParams();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState('');
  useEffect(() => { void api.get(`/reports/${report}`).then((response) => setRows(response.data.rows)).catch((error) => setMessage((error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'No fue posible cargar el informe.')); }, [report]);
  const exportCsv = () => {
    const headers = Object.keys(rows[0] ?? {});
    downloadCsv(`${report}.csv`, headers.map((header) => header.replaceAll('_', ' ')), rows.map((row) => headers.map((header) => row[header])));
  };
  return <section><PageHeading eyebrow="INFORMES" title={report.replaceAll('-', ' ')} description="Consulta y descarga el informe disponible para tu perfil." />{message && <p className="notice">{message}</p>}<div className="filter-bar compact"><span>{rows.length} registros</span><button type="button" className="button button-primary" onClick={exportCsv} disabled={!rows.length}><FileBarChart size={16} />Exportar CSV</button></div><div className="table-wrap"><table><thead><tr>{rows[0] ? Object.keys(rows[0]).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>) : <th>Sin resultados</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{Object.keys(row).map((key) => <td key={key}>{String(row[key] ?? '')}</td>)}</tr>)}</tbody></table></div></section>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><span className="status-dot"/> CARGANDO SESION</div>;
  if (!user) return <Login />;
  return <Shell />;
}

function ReportsRoute() {
  const { report = '' } = useParams();
  const permissions: Record<string, string> = {
    'central-servired': 'reports:central', 'central-multired': 'reports:central', ti: 'reports:ti',
    'commercial-yesterday': 'reports:commercial', 'commercial-missing': 'reports:commercial',
    accounting: 'reports:accounting', 'accounting-no-print': 'reports:accounting',
    audit: 'reports:audit', 'audit-no-print': 'reports:audit-operations',
  };
  return permissions[report] ? <Guard permission={permissions[report]}><ReportsData /></Guard> : <NotFound />;
}