import React, { useState, useEffect } from 'react';
import api from '../api/axios';

const TelemetryConsole = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeLog, setActiveLog] = useState(null);

  const fetchTelemetryData = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('👤 No session active. Please log in to view telemetry.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/auth/login/telemetry');
      if (response.data?.success) {
        setLogs(response.data.telemetry || []);
      } else {
        setError('Failed to load telemetry logs.');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error connecting to telemetry service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetryData();
  }, []);

  const getErrorTypeBadgeColor = (type) => {
    switch (type) {
      case 'replay_attack':
        return { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', text: '#f87171', label: '⚔️ Replay Attack' };
      case 'revoked_token_reuse':
        return { bg: 'rgba(239, 68, 68, 0.15)', border: '#f87171', text: '#fca5a5', label: '❌ Revoked Reuse' };
      case 'expired_refresh_token':
        return { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b', text: '#fbbf24', label: '⏳ Expired Refresh' };
      case 'missing_cookie_or_token':
        return { bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', text: '#60a5fa', label: '🍪 Missing Cookie/Token' };
      case 'invalid_token':
        return { bg: 'rgba(139, 92, 246, 0.2)', border: '#8b5cf6', text: '#a78bfa', label: '🔑 Invalid Token' };
      default:
        return { bg: 'rgba(156, 163, 175, 0.2)', border: '#9ca3af', text: '#e5e7eb', label: type };
    }
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '750px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Security Telemetry Log</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Real-time DB recording of session failures and rotation race conditions
          </p>
        </div>
        <button 
          className="btn btn-primary" 
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} 
          onClick={fetchTelemetryData}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : '🔄 Sync Logs'}
        </button>
      </div>

      {error ? (
        <div style={{ color: '#ef4444', textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
          {error}
        </div>
      ) : logs.length === 0 ? (
        <div style={{ color: '#475569', textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
          {loading ? 'Loading telemetry logs...' : 'No telemetry failure events recorded yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Scrollable list */}
          <div style={{ maxHeight: '550px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>ID</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Time</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Error Type</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Client</th>
                  <th style={{ padding: '0.75rem 1rem' }}>IP Address</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const badge = getErrorTypeBadgeColor(log.error_type);
                  return (
                    <tr 
                      key={log.id} 
                      style={{ 
                        borderBottom: '1px solid rgba(255,255,255,0.05)', 
                        background: activeLog?.id === log.id ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                        cursor: 'pointer'
                      }}
                      onClick={() => setActiveLog(log)}
                    >
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>#{log.id}</td>
                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ 
                          padding: '0.2rem 0.5rem', 
                          borderRadius: '6px', 
                          background: badge.bg, 
                          border: `1px solid ${badge.border}`, 
                          color: badge.text,
                          fontSize: '0.7rem',
                          fontWeight: 'bold',
                          display: 'inline-block'
                        }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textTransform: 'capitalize' }}>{log.client_type}</td>
                      <td style={{ padding: '0.75rem 1rem' }}><code>{log.ip_address}</code></td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <button 
                          className="btn" 
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', backgroundColor: '#374151', color: 'white', border: 'none', borderRadius: '4px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLog(log);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Details Section */}
          {activeLog && (
            <div style={{ 
              background: 'rgba(15, 23, 42, 0.9)', 
              border: `1px solid ${getErrorTypeBadgeColor(activeLog.error_type).border}`, 
              padding: '1.25rem', 
              borderRadius: '12px',
              animation: 'fadeIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                <span style={{ fontWeight: 'bold', color: 'white', fontSize: '0.9rem' }}>
                  🔍 Failure Details [Event ID: #{activeLog.id}]
                </span>
                <button 
                  onClick={() => setActiveLog(null)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Close ✕
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <div>
                  <strong>User ID:</strong> {activeLog.user_id || 'Guest/Anonymous'}
                </div>
                <div>
                  <strong>Timestamp:</strong> {new Date(activeLog.created_at).toLocaleString()}
                </div>
                <div>
                  <strong>IP Address:</strong> <code>{activeLog.ip_address}</code>
                </div>
                <div>
                  <strong>Client Flow:</strong> <span style={{ textTransform: 'capitalize' }}>{activeLog.client_type}</span>
                </div>
                <div style={{ gridColumn: 'span 2', wordBreak: 'break-all' }}>
                  <strong>User Agent:</strong> {activeLog.user_agent}
                </div>

                {/* Dump Payloads */}
                <div style={{ gridColumn: 'span 2', marginTop: '0.5rem' }}>
                  <strong>Filtered Request Payload:</strong>
                  <pre style={{ 
                    marginTop: '0.3rem', 
                    background: 'rgba(0,0,0,0.3)', 
                    padding: '0.6rem', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.05)',
                    color: '#fbbf24',
                    fontSize: '0.7rem',
                    overflowX: 'auto'
                  }}>
                    {JSON.stringify(activeLog.payload_dump, null, 2)}
                  </pre>
                </div>

                {/* Headers */}
                <div style={{ gridColumn: 'span 2' }}>
                  <strong>Filtered Headers Dump:</strong>
                  <pre style={{ 
                    marginTop: '0.3rem', 
                    background: 'rgba(0,0,0,0.3)', 
                    padding: '0.6rem', 
                    borderRadius: '8px', 
                    border: '1px solid rgba(255,255,255,0.05)',
                    color: '#60a5fa',
                    fontSize: '0.7rem',
                    overflowX: 'auto'
                  }}>
                    {JSON.stringify(activeLog.headers_dump, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TelemetryConsole;
