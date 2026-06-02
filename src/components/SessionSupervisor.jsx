import React, { useState, useEffect } from 'react';
import api from '../api/axios';

const SessionSupervisor = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);

  // Sync / Fetch sessions from API
  const fetchSessions = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('👤 No session active. Please log in as an administrator.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/auth/login/supervisor/sessions');
      if (response.data?.success) {
        setSessions(response.data.sessions || []);
      } else {
        setError(response.data?.message || 'Failed to load active sessions.');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error connecting to admin session service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (sessions.length === 0) return;

    const timer = setInterval(() => {
      setSessions((prevSessions) =>
        prevSessions.map((session) => {
          if (!session.is_active) return session;

          const nextAccess = session.access_seconds_remaining > 0 ? session.access_seconds_remaining - 1 : 0;
          const nextRefresh = session.refresh_seconds_remaining > 0 ? session.refresh_seconds_remaining - 1 : 0;

          return {
            ...session,
            access_seconds_remaining: nextAccess,
            refresh_seconds_remaining: nextRefresh,
            // If refresh token expires, mark inactive
            is_active: nextRefresh > 0 && session.is_active,
          };
        })
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [sessions.length]);

  // Handle force revocation of entire chain
  const handleRevoke = async (e, sessionId) => {
    e.stopPropagation();
    if (!window.confirm('⚠️ Are you sure you want to FORCE REVOKE this entire session and all its rotated children/ancestors? The user will be immediately logged out.')) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const response = await api.delete(`/auth/login/supervisor/sessions/${sessionId}`);
      if (response.data?.success) {
        setSuccessMsg(`✅ Session #${sessionId} and its complete token chain revoked successfully!`);
        setSelectedSession(null);
        await fetchSessions();
      } else {
        setError('Failed to revoke session.');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error revoking session.');
    } finally {
      setLoading(false);
    }
  };

  // Time formatter helpers
  const formatSeconds = (totalSeconds) => {
    if (totalSeconds <= 0) return 'Expired';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };

  // Filtered sessions
  const filteredSessions = sessions.filter((s) => {
    const search = searchTerm.toLowerCase();
    return (
      s.user_name.toLowerCase().includes(search) ||
      s.user_email.toLowerCase().includes(search) ||
      s.ip_address.toLowerCase().includes(search) ||
      s.id.toString().includes(search)
    );
  });

  const activeSessionsCount = sessions.filter((s) => s.is_active).length;
  const revokedCount = sessions.filter((s) => s.revoked).length;

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '500px', animation: 'fadeIn 0.3s ease' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            👥 Admin Session Supervisor
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Real-time live telemetry of all tenant session keys, rotation logs, and active countdown meters.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            className="btn btn-secondary"
            style={{ padding: '0.5rem 1rem', fontSize: '0.75rem' }} 
            onClick={fetchSessions}
            disabled={loading}
          >
            {loading ? 'Syncing...' : '🔄 Live Sync'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'rgba(15, 23, 42, 0.4)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Keys</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', marginTop: '0.25rem', color: '#60a5fa' }}>{sessions.length}</div>
        </div>
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Active Sessions</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', marginTop: '0.25rem', color: '#34d399' }}>{activeSessionsCount}</div>
        </div>
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Revoked Keys</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', marginTop: '0.25rem', color: '#f87171' }}>{revokedCount}</div>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ color: '#34d399', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
          {successMsg}
        </div>
      )}

      {/* Search Input */}
      <div style={{ marginBottom: '1rem' }}>
        <input 
          type="text"
          placeholder="🔍 Search by user email, name, IP address, or token ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            color: 'white',
            fontSize: '0.85rem',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {sessions.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem 0', color: 'var(--text-secondary)' }}>
          <div>{loading ? 'Syncing sessions from the backend...' : 'No active sessions found.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Active sessions list */}
          <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', background: 'rgba(15, 23, 42, 0.4)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left', minWidth: '700px' }}>
              <thead>
                <tr style={{ background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '0.75rem 1.25rem' }}>ID</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>User / Email</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Access Token (Est.)</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Refresh Token</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Rotations</th>
                  <th style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => {
                  const hasUsed = session.used_at !== null;
                  const isExpired = !session.is_active && !session.revoked && hasUsed;

                  return (
                    <tr 
                      key={session.id} 
                      style={{ 
                        borderBottom: '1px solid rgba(255,255,255,0.04)', 
                        background: selectedSession?.id === session.id ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease'
                      }}
                      onClick={() => setSelectedSession(session)}
                    >
                      <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-secondary)' }}>#{session.id}</td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        <div><strong>{session.user_name}</strong></div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{session.user_email}</div>
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        {session.revoked ? (
                          <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', fontSize: '0.65rem', fontWeight: 'bold' }}>REVOKED</span>
                        ) : session.is_active ? (
                          <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#34d399', fontSize: '0.65rem', fontWeight: 'bold' }}>ACTIVE</span>
                        ) : hasUsed ? (
                          <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '0.65rem', fontWeight: 'bold' }}>ROTATED</span>
                        ) : (
                          <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(107, 114, 128, 0.15)', border: '1px solid #6b7280', color: '#9ca3af', fontSize: '0.65rem', fontWeight: 'bold' }}>EXPIRED</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        {session.is_active ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ fontFamily: 'monospace', color: session.access_seconds_remaining < 60 ? '#f87171' : '#60a5fa' }}>
                              {formatSeconds(session.access_seconds_remaining)}
                            </div>
                            <div style={{ width: '80px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%',
                                width: `${Math.min(100, (session.access_seconds_remaining / 300) * 100)}%`,
                                background: session.access_seconds_remaining < 60 ? '#ef4444' : '#3b82f6',
                                transition: 'width 1s linear'
                              }} />
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div style={{ fontFamily: 'monospace', color: session.refresh_seconds_remaining < 300 ? '#f87171' : '#10b981' }}>
                            {formatSeconds(session.refresh_seconds_remaining)}
                          </div>
                          {session.is_active && (
                            <div style={{ width: '80px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%',
                                width: `${Math.min(100, (session.refresh_seconds_remaining / 900) * 100)}%`,
                                background: session.refresh_seconds_remaining < 300 ? '#ef4444' : '#10b981',
                                transition: 'width 1s linear'
                              }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem' }}>
                          🔁 Depth: {session.rotation_depth}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>
                        <button
                          className="btn"
                          disabled={session.revoked || !session.is_active}
                          onClick={(e) => handleRevoke(e, session.id)}
                          style={{
                            padding: '0.3rem 0.6rem',
                            fontSize: '0.7rem',
                            background: session.revoked || !session.is_active ? 'rgba(239, 68, 68, 0.1)' : '#ef4444',
                            color: session.revoked || !session.is_active ? 'rgba(255,255,255,0.3)' : 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: session.revoked || !session.is_active ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Revoke Chain
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Session Details / Chain genealogy */}
          {selectedSession && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
              marginTop: '1rem',
              animation: 'fadeIn 0.2s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🔑 Session Key Inspector [ID: #{selectedSession.id}]
                </span>
                <button 
                  onClick={() => setSelectedSession(null)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  Close ✕
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div><strong>User:</strong> {selectedSession.user_name} ({selectedSession.user_email})</div>
                <div><strong>Created:</strong> {new Date(selectedSession.created_at).toLocaleString()}</div>
                <div><strong>Expires:</strong> {new Date(selectedSession.expires_at).toLocaleString()}</div>
                <div><strong>IP Address:</strong> <code>{selectedSession.ip_address}</code></div>
                <div><strong>Parent Key ID:</strong> {selectedSession.parent_id ? `#${selectedSession.parent_id}` : 'None (Root Node)'}</div>
                <div><strong>Used At:</strong> {selectedSession.used_at ? new Date(selectedSession.used_at).toLocaleString() : 'Not rotated yet'}</div>
                <div style={{ gridColumn: 'span 2' }}><strong>User Agent:</strong> {selectedSession.user_agent}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SessionSupervisor;
