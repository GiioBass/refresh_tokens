import React, { useState, useEffect, useRef } from 'react';

const LogConsole = () => {
  const [logs, setLogs] = useState([
    { id: 1, type: 'info', message: 'System initialized. Ready for auth testing.', timestamp: new Date().toLocaleTimeString() }
  ]);
  const consoleRef = useRef(null);

  useEffect(() => {
    const handleLog = (event) => {
      setLogs(prev => [...prev, {
        id: Date.now(),
        ...event.detail,
        timestamp: new Date().toLocaleTimeString()
      }]);
    };

    window.addEventListener('api-log', handleLog);
    return () => window.removeEventListener('api-log', handleLog);
  }, []);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Activity Console</h2>
        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }} onClick={() => setLogs([])}>
          Clear
        </button>
      </div>
      <div className="console" ref={consoleRef}>
        {logs.map((log, index) => (
          <div 
            key={log.id} 
            className={`console-entry ${log.type}`}
            style={{ 
              wordBreak: 'break-all', 
              whiteSpace: 'pre-wrap'
            }}
          >
            <span className="timestamp">[{log.timestamp}]</span>
            <span className="message">{log.message}</span>
          </div>
        ))}
        {logs.length === 0 && <div style={{ color: '#475569', textAlign: 'center', marginTop: '2rem' }}>No activity logs yet.</div>}
      </div>
    </div>
  );
};

export default LogConsole;
