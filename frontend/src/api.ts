import axios from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/* El legado cerraba la sesion a los 30 minutos de inactividad. Aqui una
   respuesta 401 (sesion vencida, cuenta desactivada o cookie caducada) devuelve
   al usuario al formulario de entrada sin exigir recargar la pagina. */
export const SESSION_EXPIRED_EVENT = 'control-anulados:sesion-vencida';

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    return Promise.reject(error);
  },
);