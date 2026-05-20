import axios from "axios";
import { logout } from "../auth/api/authApi";
import useAuthStore from "../auth/store/useAuthStore";
import { refreshToken } from "./urls.config";

// Flag to avoid registering interceptors more than once across renders/routes
let hasConfiguredAxios = false;
// Flag to prevent multiple redirects
let isRedirecting = false;
// Flag to prevent multiple refresh requests
let isRefreshing = false;
let refreshPromise = null;
let refreshScheduled = false;
// Function to refresh the access token
const refreshAccessToken = async () => {
  if (isRefreshing) {
    return refreshPromise;
  }
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await axios.post(
        refreshToken,
        {},
        {
          withCredentials: true,
          headers: {
            "X-Client-Type": "web",
          },
          _isRefreshRequest: true,
        },
      );
      const { access_token, expires_in } = response.data;
      const { setAuthData, permissions, user } = useAuthStore.getState();
      // Update only access_token and expires_in, keep current user
      setAuthData(expires_in, access_token, permissions, user);
      return access_token;
    } catch (error) {
      console.error(
        ":x: [REFRESH] Error:",
        error?.response?.status,
        error?.response?.data,
      );
      throw error;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};
// Function to check if token needs refresh (30 seconds before expiration)
const shouldRefreshToken = () => {
  if (typeof window === "undefined") return false;
  const expiresIn = localStorage.getItem("expiresIn");
  const tokenTimestamp = localStorage.getItem("tokenTimestamp");
  if (!expiresIn || !tokenTimestamp) {
    return false;
  }
  const tokenTimestampMs = parseInt(tokenTimestamp);
  const expiresInMs = parseInt(expiresIn) * 1000; // expires_in comes in seconds, convert to ms
  const expirationTime = tokenTimestampMs + expiresInMs;
  const currentTime = Date.now();
  const timeUntilExpiration = expirationTime - currentTime;
  // Refresh if less than 30 seconds (30000ms) until expiration
  const shouldRefresh = timeUntilExpiration < 30000 && timeUntilExpiration > 0;
  return shouldRefresh;
};
// Schedule token refresh exactly 30 seconds before expiration
let refreshTimeout = null;
export const stopTokenRefresh = () => {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
};
const scheduleTokenRefresh = () => {
  if (typeof window === "undefined") return;
  // Clear any existing timeout
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }
  const expiresIn = localStorage.getItem("expiresIn");
  if (!expiresIn) {
    return;
  }
  // expiresIn comes in seconds, subtract 30 seconds and convert to milliseconds
  const expiresInSeconds = parseInt(expiresIn);
  const refreshDelaySeconds = expiresInSeconds - 30; // Refresh 30 seconds before expiration
  const delayMs = Math.max(refreshDelaySeconds * 1000, 0); // Ensure non-negative
  refreshTimeout = setTimeout(() => {
    refreshAccessToken().catch((err) => {
      console.error(":x: [SCHEDULE] Failed to refresh token:", err);
    });
  }, delayMs);
};
// Hook into setAuthData to schedule refresh when token is set
const originalSetAuthData = useAuthStore.getState().setAuthData;
useAuthStore.setState({
  setAuthData: (expiresIn, token, permissions, user) => {
    originalSetAuthData(expiresIn, token, permissions, user);
    scheduleTokenRefresh();
  },
});
export const getTenantFromSubdomain = () => {
  console.log("Getting tenant from subdomain...");
  if (typeof window === "undefined") return undefined;

  const host = window.location.host; // ej: "cliente1.midominio.com" o "localhost:3000"

  // Quitar el puerto si existe
  const [hostname] = host.split(":"); // "cliente1.midominio.com"

  const parts = hostname.split("."); // ["cliente1", "midominio", "com"]

  console.log("Hostname parts:", hostname);

  // Si estás en localhost, puedes usar un valor fijo para pruebas
  if (hostname === "localhost") {
    return "premaster"; // o el tenant que quieras usar por defecto
  }

  // Si solo tienes "midominio.com" (sin subdominio), no hay tenant
  if (parts.length < 3) {
    return undefined;
  }

  // Tomamos solo el primer segmento como tenant (cliente1.midominio.com -> "cliente1")
  const subdomain = parts[0];

  return subdomain;
};
// Configurar interceptor global una sola vez
const setupAxiosGlobally = () => {
  if (hasConfiguredAxios) return;
  hasConfiguredAxios = true;

  // Set default headers that will be included in all requests
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tenant = getTenantFromSubdomain();

  axios.defaults.headers.common["Timezone"] = timezone;
  axios.defaults.headers.common["X-Client-Type"] = "web";
  if (tenant) {
    axios.defaults.headers.common["X-Tenant"] = tenant;
  }

  // Interceptor para todas las peticiones
  axios.interceptors.request.use(
    async (config) => {
      // Obtener timezone del navegador
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Agregar timezone y X-Client-Type a todos los headers automáticamente
      config.headers["Timezone"] = timezone;
      config.headers["X-Client-Type"] = "web";

      const tenant = getTenantFromSubdomain();
      if (tenant) {
        config.headers["X-Tenant"] = tenant;
      }
      // Inject Bearer token automatically — actions no longer need to pass it manually
      const { token } = useAuthStore.getState();
      if (token && !config.headers["Authorization"]) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
      // Check if token needs refresh before making the request
      const needsRefresh = shouldRefreshToken();
      if (needsRefresh && !refreshScheduled && config.url !== refreshToken) {
        refreshScheduled = true;
        try {
          const newToken = await refreshAccessToken();
          // Update Authorization header with new token if present
          if (config.headers.Authorization) {
            config.headers.Authorization = `Bearer ${newToken}`;
          }
        } catch (error) {
          console.error(":x: [REQUEST] Failed to refresh token:", error);
          refreshScheduled = false; // Reset on error
        }
      }
      return config;
    },
    (error) => {
      console.error(" [REQUEST] Interceptor error:", error);
      return Promise.reject(error);
    },
  );
  // Interceptor for responses - handle 401 Unauthorized
  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      // Check different places where status code might be
      const status =
        error.response?.status || error.status || error?.response?.data?.status;
      // Redirect to login on 401 Unauthorized
      const isAuthError = status === 401;
      // Si el error viene de la petición de refresh, hacer logout inmediato
      if (error.config?._isRefreshRequest && isAuthError) {
        console.error(":x: [REFRESH] Refresh token is invalid. Logging out.");
        if (typeof window !== "undefined") {
          // Solo mostrar el modal, NO hacer logout ni redirección automática
          const { setShowSessionExpiredModal } = useAuthStore.getState();
          if (setShowSessionExpiredModal) {
            setShowSessionExpiredModal(true);
          }
        }
        return Promise.reject(error);
      }
      if (isAuthError && !isRedirecting) {
        isRedirecting = true;
        refreshScheduled = true;
        try {
          const newToken = await refreshAccessToken();
          // Update Authorization header with new token if present
          error.config.headers.Authorization = `Bearer ${newToken}`;
          isRedirecting = false;
          return axios(error.config);
        } catch (refreshError) {
          console.error(":x: [401] Failed to refresh token:", refreshError);
          if (typeof window !== "undefined") {
            // Use logout function with clearAuthData from store
            const { clearAuthData } = useAuthStore.getState();
            logout(clearAuthData);
            // Small delay to ensure cleanup completes
            setTimeout(() => {
              window.location.href = `${window.location.origin}/login`;
            }, 100);
          } else {
            isRedirecting = false;
          }
          return Promise.reject(refreshError);
        }
      }
      return Promise.reject(error);
    },
  );
};
export default setupAxiosGlobally;