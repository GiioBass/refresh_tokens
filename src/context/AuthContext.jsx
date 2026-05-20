import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { dispatchLog } from '../api/axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleLogoutEvent = () => {
      logout();
    };
    window.addEventListener('logout-event', handleLogoutEvent);
    return () => window.removeEventListener('logout-event', handleLogoutEvent);
  }, []);

  const login = async (email, password, clientType = 'mobile') => {
    setLoading(true);
    try {
      const loginPath = import.meta.env.VITE_API_LOGIN_PATH;
      const response = await api.post(loginPath, { 
        email, 
        password,
        app_id: import.meta.env.VITE_APP_ID || '' 
      });

      const { token } = response.data;
      
      // Guardamos el token inicial
      localStorage.setItem('access_token', token);
      localStorage.setItem('client-type', clientType);
      dispatchLog('info', `📧 [STEP 1 SUCCESS] Email authenticated. Proceeding to PIN step...`);

      // AUTOMATIZACIÓN: Llamamos al paso 2 inmediatamente
      const pin = import.meta.env.VITE_DEFAULT_PIN || '8888';
      return await loginByPin(pin);
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      dispatchLog('error', `❌ [AUTHENTICATION FAILED] ${errorMsg}`);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.clear();
    dispatchLog('info', '🚪 [LOGOUT] User logged out and storage cleared.');
  };

  const loginByPin = async (pin) => {
    setLoading(true);
    try {
      const pinPath = import.meta.env.VITE_API_PIN_LOGIN_PATH;
      const currentToken = localStorage.getItem('access_token');
      
      const response = await api.post(pinPath, {
        pin: pin,
        app_id: 2 // Actualizado según el nuevo curl
      }, {
        headers: { 'Authorization': `Bearer ${currentToken}` }
      });

      const { user, token, refresh_token, expires_in } = response.data;

      // Ahora sí guardamos todo y activamos la sesión
      setUser(user);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('access_token', token);
      localStorage.setItem('token_timestamp', Date.now().toString());
      if (expires_in) localStorage.setItem('expires_in', expires_in.toString());
      if (refresh_token) localStorage.setItem('refresh_token', refresh_token);

      dispatchLog('success', `🔢 [STEP 2 SUCCESS] PIN authenticated. Final session started for ${user.name}.`);
      window.dispatchEvent(new CustomEvent('token-update'));
      return { success: true };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      dispatchLog('error', `❌ [STEP 2 FAILED] ${errorMsg}`);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, loginByPin, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
