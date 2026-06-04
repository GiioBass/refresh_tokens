import React, { useState, useEffect } from 'react';
import api from '../api/axios';

const SessionSupervisor = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [expandedChains, setExpandedChains] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [clockSkew, setClockSkew] = useState(0);

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
        if (response.data.server_time) {
          const clientTime = Date.now();
          const serverTime = new Date(response.data.server_time).getTime();
          setClockSkew(serverTime - clientTime);
        }
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

    const handleSync = () => {
      fetchSessions();
    };

    // Auto-refresh lists when any local tokens rotate
    window.addEventListener('token-update', handleSync);
    window.addEventListener('token-diagnostics-updated', handleSync);

    // Poll every 10 seconds to keep live telemetry sync'd with DB
    const interval = setInterval(fetchSessions, 10000);

    return () => {
      window.removeEventListener('token-update', handleSync);
      window.removeEventListener('token-diagnostics-updated', handleSync);
      clearInterval(interval);
    };
  }, []);

  // Countdown timer and current time ticker effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
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
        setError(response.data?.message || 'Failed to revoke session.');
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

  // Duration active helper (used_at - created_at OR now - created_at)
  const formatDurationActive = (createdAtStr, usedAtStr, expiresAtStr) => {
    const created = new Date(createdAtStr);
    const expires = new Date(expiresAtStr);
    const nowServer = new Date(Date.now() + clockSkew);
    
    let end;
    if (usedAtStr) {
      end = new Date(usedAtStr);
    } else if (expiresAtStr && nowServer > expires) {
      end = expires;
    } else {
      end = nowServer;
    }
    
    const diffMs = end - created;
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));

    const h = Math.floor(diffSecs / 3600);
    const m = Math.floor((diffSecs % 3600) / 60);
    const s = diffSecs % 60;

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };

  // Check if token rotation window estimation was met
  const checkIfEstimationMet = (createdAtStr, expiresAtStr, usedAtStr) => {
    const created = new Date(createdAtStr);
    const expires = new Date(expiresAtStr);
    const end = usedAtStr ? new Date(usedAtStr) : new Date(Date.now() + clockSkew);
    
    if (end <= expires) {
      return {
        met: true,
        text: '✓',
        color: '#10b981'
      };
    } else {
      return {
        met: false,
        text: '✗',
        color: '#ef4444'
      };
    }
  };

  // Toggle chain expansion
  const toggleChain = (e, rootId) => {
    e.stopPropagation();
    setExpandedChains((prev) => ({
      ...prev,
      [rootId]: !prev[rootId]
    }));
  };

  // ----------------------------------------------------
  // GROUPING LOGIC FOR NESTED SESSION CHAINS
  // ----------------------------------------------------
  // We trace each token up to its root parent (parent_id = null)
  // to group all tokens belonging to the same chain.
  const buildChains = () => {
    const tokenMap = {};
    sessions.forEach(s => {
      tokenMap[s.id] = s;
    });

    const findRootId = (token) => {
      let current = token;
      let depthLimit = 100; // prevent loops
      while (current.parent_id && tokenMap[current.parent_id] && depthLimit > 0) {
        current = tokenMap[current.parent_id];
        depthLimit--;
      }
      return current.id;
    };

    // Group sessions by root ID
    const groups = {};
    sessions.forEach(s => {
      const rootId = findRootId(s);
      if (!groups[rootId]) {
        groups[rootId] = [];
      }
      groups[rootId].push(s);
    });

    // Process groups to identify the active head and order the chain
    const chainList = [];
    Object.keys(groups).forEach(rootId => {
      const list = groups[rootId].sort((a, b) => a.id - b.id); // oldest first
      
      // The latest token in the array is the current "head" of the session
      const head = list[list.length - 1];
      
      // All other tokens are the rotated history (sorted newest first for readability in dropdown)
      const history = list.slice(0, -1).reverse();

      chainList.push({
        rootId: parseInt(rootId, 10),
        head,
        history,
        totalRotations: list.length - 1
      });
    });

    // Filter by status of the head token
    let filtered = chainList;
    if (statusFilter !== 'ALL') {
      filtered = filtered.filter(({ head }) => {
        const hasUsed = head.used_at !== null;
        let tokenStatus = 'EXPIRED';
        if (head.revoked) tokenStatus = 'REVOKED';
        else if (head.is_active) tokenStatus = 'ACTIVE';
        else if (hasUsed) tokenStatus = 'ROTATED';
        
        return tokenStatus === statusFilter;
      });
    }

    // Apply search filter on the chain head user details or IP
    return filtered.filter(({ head }) => {
      const search = searchTerm.toLowerCase();
      return (
        head.user_name.toLowerCase().includes(search) ||
        head.user_email.toLowerCase().includes(search) ||
        head.ip_address.toLowerCase().includes(search) ||
        head.id.toString().includes(search)
      );
    });
  };

  const activeSessionsCount = sessions.filter((s) => s.is_active).length;
  const revokedCount = sessions.filter((s) => s.revoked).length;

  const filteredChains = buildChains();

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '750px', animation: 'fadeIn 0.3s ease' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            👥 Admin Session Supervisor
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Visualizes session genealogy, parent connections, rotation sequences, and active token lifespans.
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

      {/* Status Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
        {['ALL', 'ACTIVE', 'ROTATED', 'EXPIRED', 'REVOKED'].map((status) => {
          const isActive = statusFilter === status;
          let activeColor = '#3b82f6'; // default blue
          if (status === 'ACTIVE') activeColor = '#10b981';
          if (status === 'ROTATED') activeColor = '#f59e0b';
          if (status === 'EXPIRED') activeColor = '#9ca3af';
          if (status === 'REVOKED') activeColor = '#ef4444';

          // Count matching sessions for badge counts
          const count = status === 'ALL' 
            ? sessions.filter(s => s.used_at === null || s.is_active || s.revoked).length // approximate total distinct head chains
            : sessions.filter(s => {
                const hasUsed = s.used_at !== null;
                let tokenStatus = 'EXPIRED';
                if (s.revoked) tokenStatus = 'REVOKED';
                else if (s.is_active) tokenStatus = 'ACTIVE';
                else if (hasUsed) tokenStatus = 'ROTATED';
                return tokenStatus === status;
              }).length;

          return (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '8px',
                border: 'none',
                background: isActive ? activeColor : 'rgba(255,255,255,0.03)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              {status === 'ALL' ? '🌐 ALL' : status}
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                padding: '0.1rem 0.4rem',
                borderRadius: '10px',
                fontSize: '0.65rem',
                color: isActive ? 'white' : 'var(--text-secondary)'
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left', minWidth: '1150px' }}>
              <thead>
                <tr style={{ background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '0.75rem 1.25rem', width: '40px' }}></th>
                  <th style={{ padding: '0.75rem 1.25rem', width: '80px' }}>Head ID</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>User / Email</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Status</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Device</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>IP Address</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Access Token (Est.)</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Refresh Token</th>
                  <th style={{ padding: '0.75rem 1.25rem', minWidth: '120px' }}>Active Duration</th>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Rotations</th>
                  <th style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredChains.map(({ rootId, head, history, totalRotations }) => {
                  const isExpanded = !!expandedChains[rootId];
                  const hasUsed = head.used_at !== null;

                  return (
                    <React.Fragment key={rootId}>
                      {/* Main Active Head Row */}
                      <tr 
                        style={{ 
                          borderBottom: isExpanded ? 'none' : '1px solid rgba(255,255,255,0.04)', 
                          background: selectedSession?.id === head.id ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background 0.2s ease'
                        }}
                        onClick={() => setSelectedSession(head)}
                      >
                        <td style={{ padding: '0.75rem 1.25rem', textAlign: 'center' }}>
                          {history.length > 0 ? (
                            <button
                              onClick={(e) => toggleChain(e, rootId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#60a5fa',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                padding: 0,
                                outline: 'none'
                              }}
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>•</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem', color: '#60a5fa', fontWeight: 'bold' }}>#{head.id}</td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          <div><strong>{head.user_name}</strong></div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{head.user_email}</div>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          {head.revoked ? (
                            <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#f87171', fontSize: '0.65rem', fontWeight: 'bold' }}>REVOKED</span>
                          ) : head.is_active ? (
                            <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#34d399', fontSize: '0.65rem', fontWeight: 'bold' }}>ACTIVE</span>
                          ) : hasUsed ? (
                            <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '0.65rem', fontWeight: 'bold' }}>ROTATED</span>
                          ) : (
                            <span style={{ padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(107, 114, 128, 0.15)', border: '1px solid #6b7280', color: '#9ca3af', fontSize: '0.65rem', fontWeight: 'bold' }}>EXPIRED</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }} title={head.user_agent}>
                            {head.device_name || 'Unknown'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          <code style={{ fontSize: '0.75rem', color: '#60a5fa' }}>{head.ip_address || '0.0.0.0'}</code>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          {head.is_active ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <div style={{ fontFamily: 'monospace', color: head.access_seconds_remaining < 60 ? '#f87171' : '#60a5fa' }}>
                                {formatSeconds(head.access_seconds_remaining)}
                              </div>
                              <div style={{ width: '80px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  width: `${Math.min(100, (head.access_seconds_remaining / 300) * 100)}%`,
                                  background: head.access_seconds_remaining < 60 ? '#ef4444' : '#3b82f6',
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
                            <div style={{ fontFamily: 'monospace', color: head.refresh_seconds_remaining < 300 ? '#f87171' : '#10b981' }}>
                              {formatSeconds(head.refresh_seconds_remaining)}
                            </div>
                            {head.is_active && (
                              <div style={{ width: '80px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  width: `${Math.min(100, (head.refresh_seconds_remaining / 900) * 100)}%`,
                                  background: head.refresh_seconds_remaining < 300 ? '#ef4444' : '#10b981',
                                  transition: 'width 1s linear'
                                }} />
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                            <span style={{ fontFamily: 'monospace', color: '#fbcfe8', whiteSpace: 'nowrap' }}>
                              {formatDurationActive(head.created_at, head.used_at, head.expires_at)}
                            </span>
                            {(() => {
                              const est = checkIfEstimationMet(head.created_at, head.expires_at, head.used_at);
                              return (
                                <span style={{ fontSize: '0.65rem', color: est.color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                  {est.text}
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem' }}>
                          <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem' }}>
                            🔁 Depth: {totalRotations}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>
                          <button
                            className="btn"
                            disabled={head.revoked || !head.is_active}
                            onClick={(e) => handleRevoke(e, head.id)}
                            style={{
                              padding: '0.3rem 0.6rem',
                              fontSize: '0.7rem',
                              background: head.revoked || !head.is_active ? 'rgba(239, 68, 68, 0.1)' : '#ef4444',
                              color: head.revoked || !head.is_active ? 'rgba(255,255,255,0.3)' : 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: head.revoked || !head.is_active ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Revoke Chain
                          </button>
                        </td>
                      </tr>

                      {/* Nested Rotated History Rows (Accordion Dropdown) */}
                      {isExpanded && history.map((token) => (
                        <tr 
                          key={token.id}
                          style={{
                            background: 'rgba(15, 23, 42, 0.25)',
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            fontSize: '0.75rem',
                            cursor: 'pointer'
                          }}
                          onClick={() => setSelectedSession(token)}
                        >
                          <td style={{ padding: '0.5rem 1.25rem', textAlign: 'center', color: '#475569' }}>
                            ↳
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#94a3b8' }}>
                            #{token.id}
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#94a3b8' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                              Preceded by: <strong style={{ color: '#a78bfa' }}>#{token.parent_id}</strong>
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem' }}>
                            {token.revoked ? (
                              <span style={{ padding: '0.1rem 0.3rem', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#f87171', fontSize: '0.6rem', fontWeight: 'bold' }}>REVOKED</span>
                            ) : (
                              <span style={{ padding: '0.1rem 0.3rem', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', color: '#fbbf24', fontSize: '0.6rem', fontWeight: 'bold' }}>ROTATED</span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#64748b' }}>
                            {token.device_name || 'Unknown'}
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#64748b' }}>
                            <code>{token.ip_address}</code>
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#64748b' }}>-</td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#64748b' }}>-</td>
                          <td style={{ padding: '0.5rem 1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                              <span style={{ fontFamily: 'monospace', color: '#e9d5ff', whiteSpace: 'nowrap' }}>
                                {formatDurationActive(token.created_at, token.used_at, token.expires_at)}
                              </span>
                              {(() => {
                                const est = checkIfEstimationMet(token.created_at, token.expires_at, token.used_at);
                                return (
                                  <span style={{ fontSize: '0.6rem', color: est.color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                    {est.text}
                                  </span>
                                );
                              })()}
                            </div>
                          </td>
                          <td style={{ padding: '0.5rem 1.25rem', color: '#64748b' }}>Spent</td>
                          <td style={{ padding: '0.5rem 1.25rem', textAlign: 'right', color: '#64748b' }}>
                            Inactive
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
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
                <div><strong>Created At:</strong> {new Date(selectedSession.created_at).toLocaleString()}</div>
                <div><strong>Expires At:</strong> {new Date(selectedSession.expires_at).toLocaleString()}</div>
                <div><strong>Device Name:</strong> <code>{selectedSession.device_name || 'Unknown'}</code></div>
                <div><strong>IP Address:</strong> <code>{selectedSession.ip_address}</code></div>
                <div><strong>Parent Key ID:</strong> {selectedSession.parent_id ? `#${selectedSession.parent_id}` : 'None (Root Node)'}</div>
                <div><strong>Used/Rotated At:</strong> {selectedSession.used_at ? new Date(selectedSession.used_at).toLocaleString() : 'Not rotated yet'}</div>
                <div><strong>Active Duration:</strong> <span style={{ color: '#fbcfe8', fontWeight: 'bold' }}>{formatDurationActive(selectedSession.created_at, selectedSession.used_at, selectedSession.expires_at)}</span></div>
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
