import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import LogConsole from './components/LogConsole';
import api, { dispatchLog } from './api/axios';

const App = () => {
  const { user, login, loginByPin, logout, loading } = useAuth();
  const [email, setEmail] = useState(import.meta.env.VITE_DEFAULT_EMAIL || '');
  const [password, setPassword] = useState(import.meta.env.VITE_DEFAULT_PASSWORD || '');
  const [pin, setPin] = useState('8888');
  const [authStep, setAuthStep] = useState('email'); // 'email' then 'pin'
  const [clientType, setClientType] = useState('mobile');
  const [refreshEnabled, setRefreshEnabled] = useState(() => {
    return localStorage.getItem('refresh-enabled') !== 'false';
  });
  const [userDataVisible, setUserDataVisible] = useState(false);
  const [autoPingEnabled, setAutoPingEnabled] = useState(false);
  
  // Timer Logic
  const getDynamicExpiry = () => parseInt(localStorage.getItem('expires_in') || import.meta.env.VITE_TOKEN_EXPIRY_SECONDS || '300');
  const [timeLeft, setTimeLeft] = useState(getDynamicExpiry());
  const [graceTime, setGraceTime] = useState(0); // Contador hacia adelante (Gracia)
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!user) {
      setGraceTime(0);
      return;
    }

    // Al iniciar sesión o cambiar usuario, forzamos el reinicio
    setTimeLeft(getDynamicExpiry());
    setGraceTime(0);

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev > 0) return prev - 1;
        // Si ya llegó a 0, empezamos a contar el tiempo de gracia
        setGraceTime((g) => g + 1);
        return 0;
      });
      setNow(new Date());
    }, 1000);

    const handleTokenUpdate = () => {
      setTimeLeft(getDynamicExpiry());
      setGraceTime(0);
      setIsProactiveRefreshing(false); // Reset flag on update
    };

    window.addEventListener('token-update', handleTokenUpdate);

    return () => {
      clearInterval(timer);
      window.removeEventListener('token-update', handleTokenUpdate);
    };
  }, [user]);

  // Proactive Refresh (30s before expiry)
  const [isProactiveRefreshing, setIsProactiveRefreshing] = useState(false);
  
  useEffect(() => {
    if (timeLeft === 30 && refreshEnabled && !isProactiveRefreshing && user) {
      setIsProactiveRefreshing(true);
      dispatchLog('warning', '⏰ [PROACTIVE] 30s remaining. Triggering early refresh...');
      handleManualRefresh();
    }
  }, [timeLeft, refreshEnabled, isProactiveRefreshing, user]);

  // Auto-Ping Logic (Sequential)
  useEffect(() => {
    let timeoutId;
    let isMounted = true;
    const PING_INTERVAL = parseInt(import.meta.env.VITE_AUTO_PING_SECONDS || '30') * 1000;

    const runPing = async () => {
      if (!autoPingEnabled || !user || !isMounted) return;

      dispatchLog('info', '📡 [AUTO-PING] Triggering periodic check...');

      await simulateProtectedCall();

      if (isMounted && autoPingEnabled) {
        timeoutId = setTimeout(runPing, PING_INTERVAL);
      }
    };

    if (autoPingEnabled && user) {
      dispatchLog('info', `📡 [AUTO-PING] Monitoring started (Every ${PING_INTERVAL/1000}s)`);
      runPing();
    }

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [autoPingEnabled, user]);

  const toggleRefresh = () => {
    const newValue = !refreshEnabled;
    setRefreshEnabled(newValue);
    localStorage.setItem('refresh-enabled', newValue);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    await login(email, password, clientType);
  };

  const simulateProtectedCall = async () => {
    try {
      // Usamos el endpoint real solicitado
      const endpoint = '/suppliers/users/information/139';
      await api.get(endpoint);
    } catch (err) {}
  };

  const handleManualRefresh = async () => {
    try {
      const refreshPath = import.meta.env.VITE_API_REFRESH_PATH;
      const clientType = localStorage.getItem('client-type') || 'web';
      
      const payload = clientType === 'mobile' 
        ? { refresh_token: localStorage.getItem('refresh_token') } 
        : {};

      await api.post(refreshPath, payload);
      // El interceptor de axios ya registrará la respuesta y disparará el evento 'token-update'
    } catch (err) {
      // Error registrado por axios
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Secure Auth System</h1>
        <p>Access & Refresh Token Rotation Demo</p>
        <div className={`status-badge ${user ? 'online' : 'offline'}`}>
          {user ? `Authenticated as ${user.name}` : 'Not Authenticated'}
        </div>
        
        {user && (
          <div style={{ 
            marginTop: '1rem', 
            background: timeLeft < 30 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(52, 211, 153, 0.1)', 
            padding: '0.5rem 1rem', 
            borderRadius: '20px',
            border: timeLeft < 30 ? '1px solid #ef4444' : '1px solid #34d399',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'all 0.3s'
          }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Token Life:</span>
            <strong style={{ fontSize: '1rem', color: timeLeft < 30 ? '#ef4444' : '#34d399' }}>
              {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </strong>
            
            {timeLeft === 0 && (
              <div style={{ marginLeft: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: '#fbbf24' }}>Overtime:</span>
                <strong style={{ fontSize: '1rem', color: '#fbbf24' }}>
                  +{Math.floor(graceTime / 60)}:{(graceTime % 60).toString().padStart(2, '0')}
                </strong>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="app-container">
        {/* Left Side: Controls */}
        <section>
          {!user ? (
            <div className="glass-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h2 style={{ fontWeight: 600, margin: 0 }}>Login</h2>
                <div style={{ padding: '0.3rem 0.6rem', borderRadius: '20px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', fontSize: '0.7rem', fontWeight: 'bold' }}>
                  2-Step Auto Login
                </div>
              </div>
              
              <form onSubmit={handleLogin}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Enter your credentials. The system will automatically complete the PIN verification.
                </p>
                <div className="form-group">
                  <label>Email Address</label>
                  <input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    placeholder="Enter email"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Client Type</label>
                  <select 
                    value={clientType} 
                    onChange={(e) => setClientType(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(15, 23, 42, 0.5)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '12px',
                      color: 'white',
                      outline: 'none'
                    }}
                  >
                    <option value="mobile">Mobile (Full JSON Flow)</option>
                    <option value="web">Web (Cookie Flow)</option>
                  </select>
                </div>
                
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                  {loading ? 'Authenticating (Email + PIN)...' : 'Sign In'}
                </button>
              </form>
            </div>
          ) : (
            <div className="glass-card">
              <h2 style={{ marginBottom: '1rem', fontWeight: 600 }}>Welcome, {user.name}!</h2>
              <p style={{ marginBottom: '2rem' }}>
                You are currently logged in. You can now test the token rotation system.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <button type="button" onClick={simulateProtectedCall} className="btn btn-primary">
                    Simulate API Call
                  </button>
                  <button 
                    type="button"
                    onClick={handleManualRefresh} 
                    className="btn"
                    style={{
                      backgroundColor: '#818cf8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '0.8rem 1.2rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Force Refresh
                  </button>
                </div>

                {/* Auto-Ping Toggle */}
                <div style={{ 
                  padding: '1rem', 
                  background: 'rgba(255,255,255,0.05)', 
                  borderRadius: '12px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  border: autoPingEnabled ? '1px solid #60a5fa' : '1px solid transparent'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      Auto-Ping (Every 30s)
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      Continuous monitoring of token validity
                    </span>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setAutoPingEnabled(!autoPingEnabled)}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: autoPingEnabled ? '#60a5fa' : '#475569',
                      color: 'white',
                      transition: 'all 0.2s'
                    }}
                  >
                    {autoPingEnabled ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                </div>

                {/* Toggle Refresh Rotation */}
                <div style={{ 
                  padding: '1rem', 
                  background: 'rgba(255,255,255,0.05)', 
                  borderRadius: '12px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center' 
                }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Automatic Token Rotation
                  </span>
                  <button 
                    onClick={toggleRefresh}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: refreshEnabled ? '#10b981' : '#ef4444',
                      color: 'white',
                      transition: 'all 0.2s'
                    }}
                  >
                    {refreshEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                
                <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', fontSize: '0.85rem' }}>
                  <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '0.5rem' }}>Tokens in storage:</p>
                  <div style={{ overflowX: 'auto' }}>
                    <code style={{ fontSize: '0.7rem', color: '#818cf8' }}>
                      Access: {localStorage.getItem('access_token')?.substring(0, 20)}...
                      <br />
                      Refresh: {localStorage.getItem('refresh_token') ? localStorage.getItem('refresh_token').substring(0, 20) + '...' : 'In Cookie (Web)'}
                    </code>
                  </div>
                </div>

                <button onClick={logout} className="btn btn-secondary">
                  Logout
                </button>
              </div>
            </div>
          )}
          
          {/* Diagnostic Panel */}
          <div className="glass-card" style={{ marginTop: '2rem', border: '1px solid #3b82f6' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1.2rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🔍 Live Auth Debugger
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.8rem' }}>
              {/* Token Timestamps */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem', borderRadius: '8px' }}>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Issued At:</p>
                  <code style={{ color: '#60a5fa', fontSize: '0.75rem' }}>
                    {localStorage.getItem('token_timestamp') 
                      ? new Date(parseInt(localStorage.getItem('token_timestamp'))).toLocaleTimeString() 
                      : 'N/A'}
                  </code>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '0.5rem' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Current:</p>
                  <code style={{ color: '#fbbf24', fontSize: '0.75rem' }}>
                    {now.toLocaleTimeString()}
                  </code>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '0.5rem' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Est. Expiry:</p>
                  <code style={{ color: '#f87171', fontSize: '0.75rem' }}>
                    {localStorage.getItem('token_timestamp') 
                      ? new Date(parseInt(localStorage.getItem('token_timestamp')) + (getDynamicExpiry() * 1000)).toLocaleTimeString() 
                      : 'N/A'}
                  </code>
                </div>
              </div>

              {/* Extra Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', padding: '0.6rem', borderRadius: '8px' }}>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Original expires_in:</p>
                  <code style={{ color: '#34d399', fontSize: '0.75rem' }}>
                    {localStorage.getItem('expires_in') || 'N/A'} seconds
                  </code>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '0.5rem' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem' }}>Status:</p>
                  <code style={{ color: timeLeft > 0 ? '#34d399' : '#ef4444', fontSize: '0.75rem' }}>
                    {timeLeft > 0 ? 'ACTIVE' : 'EXPIRED (GRACE)'}
                  </code>
                </div>
              </div>

              {/* Access Token */}
              <div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Current Access Token:</p>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <code style={{ color: '#fbbf24' }}>{localStorage.getItem('access_token') || 'None'}</code>
                </div>
              </div>

              {/* Refresh Token Storage */}
              <div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Refresh Token (LocalStorage):</p>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <code style={{ color: '#818cf8' }}>{localStorage.getItem('refresh_token') || 'None (Using Cookies or Not Logged In)'}</code>
                </div>
              </div>

              {/* Cookies Visible to JS */}
              <div>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>Visible Cookies (JS):</p>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <code style={{ color: '#34d399' }}>{document.cookie || 'No visible cookies'}</code>
                  {clientType === 'web' && <p style={{ fontSize: '0.7rem', marginTop: '0.3rem', color: '#94a3b8' }}>* HttpOnly cookies (like refresh_token) are invisible to JS.</p>}
                </div>
              </div>

              {/* User Object - MOVED TO RIGHT */}
            </div>
          </div>

          <div className="glass-card" style={{ marginTop: '2rem', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Auth Requirements Checklist</h3>
            <ul style={{ listStyle: 'none', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <li style={{ marginBottom: '0.5rem' }}>✅ X-Client-Type header: <strong>{localStorage.getItem('client-type') || 'web'}</strong></li>
              <li style={{ marginBottom: '0.5rem' }}>✅ X-Tenant header: <strong>{import.meta.env.VITE_API_TENANT || 'qa'}</strong></li>
              <li style={{ marginBottom: '0.5rem' }}>✅ Automatic Bearer injection</li>
              <li style={{ marginBottom: '0.5rem' }}>✅ 401 Interception & Refresh</li>
              <li style={{ marginBottom: '0.5rem' }}>✅ Request queueing (Concurrent calls)</li>
              <li style={{ marginBottom: '0.5rem' }}>✅ Automatic Request retry</li>
            </ul>
          </div>
        </section>

        {/* Right Side: Console & Data */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {user && (
            <div className="glass-card" style={{ padding: '1rem', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div 
                onClick={() => setUserDataVisible(!userDataVisible)}
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer' 
                }}
              >
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>👤 User Profile Information</h3>
                <span style={{ fontSize: '0.7rem', color: '#60a5fa' }}>{userDataVisible ? 'Collapse ▲' : 'Expand ▼'}</span>
              </div>
              
              {userDataVisible && (
                <pre className="fixed-scroll-area" style={{ 
                  marginTop: '1rem',
                  background: 'rgba(0,0,0,0.3)', 
                  padding: '0.6rem', 
                  borderRadius: '8px', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  color: '#34d399', 
                  fontSize: '0.7rem'
                }}>
                  {JSON.stringify(user, null, 2)}
                </pre>
              )}
            </div>
          )}
          
          <LogConsole />
        </section>
      </main>
    </div>
  );
};

export default App;
