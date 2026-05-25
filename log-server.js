import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, 'logs', 'activity.log');
const PORT = 3005; // Cambiado a 3005 para evitar conflictos

if (!fs.existsSync(path.join(__dirname, 'logs'))) {
  fs.mkdirSync(path.join(__dirname, 'logs'));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/logs') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { type = 'info', message = '', timestamp = new Date().toISOString(), details = null } = data;
        
        if (type === 'unauthorized-test') {
          const UNAUTHORIZED_LOG_FILE = path.join(__dirname, 'logs', 'unauthorized-tests.log');
          let detailsFormatted = '';
          if (details) {
            detailsFormatted = `
=========================================
🚨 UNAUTHORIZED TEST ENDPOINT 401 DETECTED
=========================================
Timestamp: ${timestamp}
Message: ${message}

[Request Context]
- URL: ${details.request?.baseURL || ''}${details.request?.url || ''}
- Method: ${(details.request?.method || '').toUpperCase()}
- Headers: ${JSON.stringify(details.request?.headers, null, 2)}
- Params: ${JSON.stringify(details.request?.params, null, 2)}
- Payload: ${JSON.stringify(details.request?.data, null, 2)}

[Response Context]
- Status: ${details.response?.status} (${details.response?.statusText || 'N/A'})
- Headers: ${JSON.stringify(details.response?.headers, null, 2)}
- Body: ${JSON.stringify(details.response?.data, null, 2)}

[Authentication Context]
- Client Type: ${details.auth?.clientType || 'N/A'}
- Access Token: ${details.auth?.accessToken || 'N/A'}
- Refresh Token: ${details.auth?.refreshToken || 'N/A'}
- Stored Timestamp: ${details.auth?.tokenTimestamp || 'N/A'} (${details.auth?.tokenTimestamp ? new Date(parseInt(details.auth.tokenTimestamp, 10)).toLocaleString() : 'N/A'})
- Expires In (seconds): ${details.auth?.expiresIn || 'N/A'}
- Token Life Remaining: ${details.auth?.tokenLifeRemaining || 'N/A'}
- Refresh Enabled: ${details.auth?.refreshEnabled || 'N/A'}
- System Time: ${details.auth?.systemTime || 'N/A'}
=========================================\n`;
          } else {
            detailsFormatted = `[${timestamp}] [UNAUTHORIZED-TEST] ${message}\n`;
          }
          fs.appendFileSync(UNAUTHORIZED_LOG_FILE, detailsFormatted);
        } else {
          const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
          fs.appendFileSync(LOG_FILE, logEntry);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Log server running at http://127.0.0.1:${PORT}`);
});
