import React, { useState, useEffect } from 'react';
import api from '../api/axios';

const TokenAuditConsole = () => {
  const [chains, setChains] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeNode, setActiveNode] = useState(null);

  const fetchAuditData = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('👤 No session active. Please log in to view audits.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/auth/login/audit');
      if (response.data?.success) {
        setChains(response.data.chains || []);
      } else {
        setError('Failed to load audit data.');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Error connecting to audit service.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, []);

  // Recursive renderer for the token tree/chain
  const renderTokenNode = (node, depth = 0) => {
    const isActive = node.is_active;
    const isRotated = node.used_at !== null && !node.revoked;
    const isRevoked = node.revoked;

    let statusColor = '#3b82f6'; // Rotated (Blue)
    let statusLabel = 'Rotated';
    if (isActive) {
      statusColor = '#10b981'; // Active (Green)
      statusLabel = 'Active (Live)';
    } else if (isRevoked) {
      statusColor = '#ef4444'; // Revoked (Red)
      statusLabel = 'Revoked (Chain Broken)';
    }

    const friendlyExpires = new Date(node.expires_at).toLocaleString();
    const friendlyCreated = new Date(node.created_at).toLocaleString();

    return (
      <div key={node.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        {/* Node Circle */}
        <div 
          onClick={() => setActiveNode(node)}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            border: `3px solid ${statusColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            cursor: 'pointer',
            boxShadow: isActive ? `0 0 15px ${statusColor}` : 'none',
            transition: 'all 0.3s',
            zIndex: 2
          }}
          title={`${statusLabel} - Click for details`}
        >
          {isActive ? '🔑' : isRevoked ? '❌' : '🔄'}
        </div>

        {/* Short Label */}
        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '0.3rem', fontWeight: 600 }}>
          ID: {node.id}
        </div>

        {/* Connector Line to Children */}
        {node.children && node.children.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <div style={{
              width: '3px',
              height: '30px',
              backgroundColor: isRevoked ? '#ef4444' : '#475569',
              zIndex: 1
            }} />
            
            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center' }}>
              {node.children.map(child => renderTokenNode(child, depth + 1))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Session Security Monitor</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            Real-time visual map of rotated refresh token families
          </p>
        </div>
        <button 
          className="btn btn-primary" 
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} 
          onClick={fetchAuditData}
          disabled={loading}
        >
          {loading ? 'Syncing...' : '🔄 Refresh Map'}
        </button>
      </div>

      {error ? (
        <div style={{ color: '#ef4444', textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
          {error}
        </div>
      ) : chains.length === 0 ? (
        <div style={{ color: '#475569', textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
          {loading ? 'Loading token hierarchy map...' : 'No active session chains found. Start by logging in.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', margin: 'auto', width: '100%', overflowX: 'auto', padding: '1rem' }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', fontSize: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.5rem', borderRadius: '8px', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }} />
              <span style={{ color: 'white' }}>Active Token (Current Device)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3b82f6' }} />
              <span style={{ color: 'white' }}>Rotated Token (Spent)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
              <span style={{ color: 'white' }}>Revoked / Broken Chain</span>
            </div>
          </div>

          {/* Connected Tree Graphs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3rem', justifyContent: 'center', width: '100%' }}>
            {chains.map((chain, idx) => (
              <div key={chain.id} style={{ 
                border: '1px solid rgba(255,255,255,0.05)', 
                background: 'rgba(0,0,0,0.2)', 
                padding: '1.5rem', 
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minWidth: '240px'
              }}>
                <span style={{ fontSize: '0.7rem', color: '#818cf8', fontWeight: 'bold', marginBottom: '1rem' }}>
                  SESSION CHAIN #{idx + 1} (Root: {chain.id})
                </span>
                
                {renderTokenNode(chain)}
              </div>
            ))}
          </div>

          {/* Interactive Node Metadata Card */}
          {activeNode && (
            <div style={{ 
              marginTop: '2rem', 
              background: 'rgba(15, 23, 42, 0.9)', 
              border: `1px solid ${activeNode.is_active ? '#10b981' : activeNode.revoked ? '#ef4444' : '#3b82f6'}`, 
              padding: '1rem', 
              borderRadius: '12px',
              animation: 'fadeIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontWeight: 'bold', color: 'white', fontSize: '0.85rem' }}>
                  🔍 Node Diagnostics [ID: {activeNode.id}]
                </span>
                <button 
                  onClick={() => setActiveNode(null)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Close ✕
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <div>
                  <strong>Parent Token ID:</strong> {activeNode.parent_id || 'None (Root Node)'}
                </div>
                <div>
                  <strong>Next Token ID:</strong> {activeNode.next_token_id || 'None (Active Leaf)'}
                </div>
                <div>
                  <strong>Created At:</strong> {new Date(activeNode.created_at).toLocaleString()}
                </div>
                <div>
                  <strong>Expires At:</strong> {new Date(activeNode.expires_at).toLocaleString()}
                </div>
                <div>
                  <strong>Used/Rotated At:</strong> {activeNode.used_at ? new Date(activeNode.used_at).toLocaleString() : 'Never (Active)'}
                </div>
                <div>
                  <strong>Status:</strong> <span style={{ color: activeNode.is_active ? '#10b981' : activeNode.revoked ? '#ef4444' : '#3b82f6', fontWeight: 'bold' }}>
                    {activeNode.is_active ? 'Active (Live)' : activeNode.revoked ? 'Revoked' : 'Rotated (Spent)'}
                  </span>
                </div>
                <div style={{ gridColumn: 'span 2', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                  <strong>Device:</strong> {activeNode.device_name || 'Unknown Device'}
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <strong>IP Address:</strong> {activeNode.ip_address || 'Unknown IP'}
                </div>
                <div style={{ gridColumn: 'span 2', wordBreak: 'break-all' }}>
                  <strong>User Agent:</strong> {activeNode.user_agent || 'Unknown UA'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TokenAuditConsole;
