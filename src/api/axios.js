import axios from 'axios';

// --- MOCK BACKEND LOGIC ---
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const REFRESH_PATH = import.meta.env.VITE_API_REFRESH_PATH || '/auth/login/refresh';

const TENANT = import.meta.env.VITE_API_TENANT || 'qa';
const TIMEZONE = import.meta.env.VITE_API_TIMEZONE || 'America/Bogota';

const api = axios.create({
  baseURL: API_BASE_URL || 'http://localhost:8001/api/v2',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client-Type': localStorage.getItem('client-type') || 'mobile',
    'X-Tenant': TENANT
  }
});

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

const LOG_SERVER_URL = '/api/logs';

const saveLogToFile = async (logData) => {
  try {
    fetch(LOG_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...logData,
        timestamp: new Date().toISOString()
      })
    });
  } catch (err) {
    // Silently fail if log server is down
  }
};

const getTokenLifeRemaining = () => {
  const token = localStorage.getItem('access_token');
  if (!token) return 'N/A';
  
  const timestampStr = localStorage.getItem('token_timestamp');
  if (!timestampStr) return 'N/A';
  
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return 'N/A';
  
  const expiresStr = localStorage.getItem('expires_in');
  const expiresIn = parseInt(expiresStr || import.meta.env.VITE_TOKEN_EXPIRY_SECONDS || '300', 10);
  
  const elapsedSeconds = Math.floor((Date.now() - timestamp) / 1000);
  const timeLeft = expiresIn - elapsedSeconds;
  
  if (timeLeft <= 0) {
    const graceTime = Math.abs(timeLeft);
    const m = Math.floor(graceTime / 60);
    const s = graceTime % 60;
    return `EXPIRED (+${m}:${s.toString().padStart(2, '0')})`;
  } else {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
};

// Global cache to prevent constant HTTP calls for token life remaining logs
let cachedRefreshSecondsRemaining = null;
let lastStatusCheckTimestamp = null;

export const getRefreshTokenLifeRemaining = () => {
  const token = localStorage.getItem('access_token');
  if (!token) return 'N/A';

  const clientType = localStorage.getItem('client-type') || 'mobile';

  // If we checked status in the last 15 seconds, we estimate from cache to prevent spamming the server in interceptor logs
  if (cachedRefreshSecondsRemaining !== null && lastStatusCheckTimestamp !== null) {
    const elapsed = Math.floor((Date.now() - lastStatusCheckTimestamp) / 1000);
    const estimatedTimeLeft = cachedRefreshSecondsRemaining - elapsed;
    
    if (estimatedTimeLeft <= 0) return 'EXPIRED';
    
    const days = Math.floor(estimatedTimeLeft / 86400);
    const hours = Math.floor((estimatedTimeLeft % 86400) / 3600);
    const minutes = Math.floor((estimatedTimeLeft % 3600) / 60);
    const secs = estimatedTimeLeft % 60;
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }

  // Trigger an asynchronous status check to update the cache for subsequent calls
  // (We don't await it here to prevent blocking standard Axios requests)
  triggerStatusCheck();

  // Fallback to static estimation if cache hasn't loaded yet
  const timestampStr = localStorage.getItem('token_timestamp');
  if (!timestampStr) return 'Estimating...';
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return 'Estimating...';
  const refreshExpiresIn = clientType === 'web' ? 1296000 : 604800; // default backup
  const elapsedSeconds = Math.floor((Date.now() - timestamp) / 1000);
  const timeLeft = refreshExpiresIn - elapsedSeconds;
  if (timeLeft <= 0) return 'EXPIRED';
  const days = Math.floor(timeLeft / 86400);
  const hours = Math.floor((timeLeft % 86400) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);
  return `~${days}d ${hours}h ${minutes}m (Est)`;
};

const triggerStatusCheck = async () => {
  const now = Date.now();
  // Limit status checks to once every 10 seconds to protect API health
  if (lastStatusCheckTimestamp && now - lastStatusCheckTimestamp < 10000) {
    return;
  }

  const token = localStorage.getItem('access_token');
  if (!token) return;

  lastStatusCheckTimestamp = now;

  try {
    const clientType = localStorage.getItem('client-type') || 'web';
    const storedRefreshToken = localStorage.getItem('refresh_token');

    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Client-Type': clientType
    };

    if (clientType === 'mobile' && storedRefreshToken) {
      headers['X-Refresh-Token'] = storedRefreshToken;
    }

    // Call raw fetch/axios to avoid interceptor loop
    const response = await axios.get((API_BASE_URL || 'http://localhost:8001/api/v2') + '/auth/login/status', {
      headers
    });

    if (response.data?.success) {
      cachedRefreshSecondsRemaining = response.data.seconds_remaining;
      lastStatusCheckTimestamp = Date.now();
      
      // Let standard UI know that token diagnostics updated
      window.dispatchEvent(new CustomEvent('token-diagnostics-updated', {
        detail: response.data
      }));
    }
  } catch (err) {
    // Gracefully handle unauthenticated/network errors on check
  }
};

export const dispatchLog = (type, message) => {
  const tokenLife = getTokenLifeRemaining();
  const refreshLife = getRefreshTokenLifeRemaining();
  const formattedMessage = `🔑[Access: ${tokenLife}] 🔄[Refresh: ${refreshLife}] ${message}`;
  const detail = { type, message: formattedMessage };
  window.dispatchEvent(new CustomEvent('api-log', { detail }));
  saveLogToFile(detail);
};

const dispatchUnauthorizedTestLog = async (error) => {
  try {
    const config = error.config || {};
    const response = error.response || {};
    
    // Auth state details
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const tokenTimestamp = localStorage.getItem('token_timestamp');
    const expiresIn = localStorage.getItem('expires_in');
    const clientType = localStorage.getItem('client-type') || 'web';
    const refreshEnabled = localStorage.getItem('refresh-enabled') !== 'false';
    const tokenLife = getTokenLifeRemaining();
    
    const details = {
      request: {
        url: config.url,
        baseURL: config.baseURL,
        method: config.method,
        headers: config.headers,
        data: config.data,
        params: config.params
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data
      },
      auth: {
        accessToken,
        refreshToken,
        tokenTimestamp,
        expiresIn,
        clientType,
        refreshEnabled,
        tokenLifeRemaining: tokenLife,
        systemTime: new Date().toISOString()
      }
    };

    const message = `🚨 [401 UNAUTHORIZED] Test endpoint ${config.method?.toUpperCase()} ${config.url} returned 401. calculated life: ${tokenLife}`;
    
    await saveLogToFile({
      type: 'unauthorized-test',
      message,
      details
    });
  } catch (err) {
    console.error('Failed to log unauthorized test error', err);
  }
};

// --- REQUEST INTERCEPTOR ---
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    const clientType = localStorage.getItem('client-type') || 'web';
    const isRefreshPath = config.url.includes(import.meta.env.VITE_API_REFRESH_PATH);
    
    // Si hay token y NO es la ruta de refresh, lo inyectamos.
    // Para el refresh, es mejor NO enviar el token viejo caducado para evitar conflictos.
    if (token && !isRefreshPath) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    config.headers['X-Client-Type'] = clientType;
    config.headers['X-Tenant'] = TENANT;
    
    if (clientType === 'web') {
      config.headers['Timezone'] = TIMEZONE;
    }
    
    const authHeader = token ? `Bearer ${token}` : 'MISSING';
    dispatchLog('info', `📤 [REQUEST] ${config.method.toUpperCase()} ${config.url} | Authorization: ${authHeader}`);
    
    return config;
  },
  (error) => Promise.reject(error)
);

// --- RESPONSE INTERCEPTOR ---
api.interceptors.response.use(
  (response) => {
    if (response.config.headers['X-Simulate-401'] === true) {
      dispatchLog('warning', '🛠 [SIMULATION] Injecting 401 Unauthorized for testing purposes.');
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      error.config = response.config;
      return Promise.reject(error);
    }

    // Registro de respuesta RAW
    const rawData = JSON.stringify(response.data);
    const isRefreshPath = response.config.url.includes(REFRESH_PATH);
    dispatchLog(isRefreshPath ? 'refresh' : 'success', `📥 [RESPONSE] ${response.status} from ${response.config.url} | Data: ${rawData}`);

    // Si la respuesta es exitosa y viene del endpoint de REFRESH (manual o automático)
    if (response.config.url.includes(import.meta.env.VITE_API_REFRESH_PATH) && response.status === 200) {
      const responseData = response.data.data || response.data;
      const { access_token, refresh_token } = responseData;

      if (access_token) {
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('token_timestamp', Date.now().toString());
        if (localStorage.getItem('client-type') === 'mobile' && refresh_token) {
          localStorage.setItem('refresh_token', refresh_token);
        }
        window.dispatchEvent(new CustomEvent('token-update'));
        dispatchLog('refresh', '🔄 [SYSTEM] Tokens updated manually from refresh endpoint.');
      }
    }
    
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest?.url?.includes('/suppliers/users/information/139')) {
      dispatchUnauthorizedTestLog(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const isRefreshEnabled = localStorage.getItem('refresh-enabled') !== 'false';
      
      if (!isRefreshEnabled) {
        dispatchLog('warning', '⛔ [REFRESH DISABLED] 401 received but automatic rotation is OFF.');
        return Promise.reject(error);
      }

      dispatchLog('warning', `🚨 [AUTH ERROR] 401 detected. Starting rotation flow...`);

      if (isRefreshing) {
        dispatchLog('info', '⏳ [QUEUE] Refresh already in progress. Queueing request.');
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = 'Bearer ' + token;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      return new Promise(async (resolve, reject) => {
        try {
          const clientType = localStorage.getItem('client-type') || 'mobile'; // Default a mobile para más estabilidad
          const storedRefreshToken = localStorage.getItem('refresh_token');
          
          // En modo Web el refresh token viaja por cookie (HttpOnly), en modo App viaja en el body
          const payload = clientType === 'web' ? {} : { refresh_token: storedRefreshToken };
          
          dispatchLog('info', `🔄 [REFRESH] Calling ${import.meta.env.VITE_API_REFRESH_PATH} (${clientType})...`);
          dispatchLog('info', `📦 [REFRESH PAYLOAD] Sending Body: ${JSON.stringify(payload)}`);
          
          const refreshResponse = await api.post(import.meta.env.VITE_API_REFRESH_PATH, payload, {
            _retry: true
          });

          // Registro de respuesta RAW de refresco
          dispatchLog('refresh', `✅ [SUCCESS] Token rotated! Response Data: ${JSON.stringify(refreshResponse.data)}`);
          
          window.dispatchEvent(new CustomEvent('token-update'));

          const responseData = refreshResponse.data.data || refreshResponse.data;
          const { access_token, refresh_token, expires_in } = responseData;
          
          localStorage.setItem('access_token', access_token);
          localStorage.setItem('token_timestamp', Date.now().toString());
          if (expires_in) localStorage.setItem('expires_in', expires_in.toString());
          
          // Solo actualizamos el refresh_token si el API lo devuelve (Mobile)
          if (clientType === 'mobile' && refresh_token) {
            localStorage.setItem('refresh_token', refresh_token);
          }
          
          api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
          originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
          
          processQueue(null, access_token);
          delete originalRequest.headers['X-Simulate-401'];
          
          resolve(api(originalRequest));
        } catch (refreshError) {
          const status = refreshError.response?.status || 'Network Error';
          const errorData = JSON.stringify(refreshError.response?.data || 'No body');
          dispatchLog('error', `❌ [CRITICAL] Refresh failed (${status}). Data: ${errorData}`);
          
          processQueue(refreshError, null);
          // localStorage.clear();
          // window.dispatchEvent(new CustomEvent('logout-event')); 
          dispatchLog('warning', '⚠️ [SYSTEM] Refresh failed, but keeping session active for debugging.');
          reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      });
    }

    const errorStatus = error.response?.status || 'Network Error';
    const errorData = JSON.stringify(error.response?.data || 'No data');
    dispatchLog('error', `✖ [ERROR] ${errorStatus} from ${error.config?.url} | Data: ${errorData}`);
    
    return Promise.reject(error);
  }
);

export default api;
