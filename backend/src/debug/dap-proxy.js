/**
 * dap-proxy.js — WebSocket ↔ TCP proxy for Debug Adapter Protocol.
 *
 * Attaches to the HTTP server and upgrades `/dap` requests to WebSocket.
 * Each WS client is connected to the active debugpy TCP port.
 * Binary data is relayed in both directions without parsing.
 *
 * Usage:
 *   import { attachDapProxy } from './dap-proxy.js';
 *   attachDapProxy(httpServer);
 */

import { WebSocketServer } from 'ws';
import net from 'net';
import { getDebugStatus, setDebugRunning } from './debug-engine.js';

/** Track active WS connections so we can close them on new debug session */
const activeConnections = new Set();

const verboseDapLogs = process.env.DAP_VERBOSE_LOGS === '1';
const dapLog = (...args) => {
  if (verboseDapLogs) console.log(...args);
};

/**
 * Close all active DAP proxy connections.
 * Called before starting a new debug session to prevent stale connections.
 */
export function closeAllDapConnections() {
  for (const ws of activeConnections) {
    try { ws.close(4002, 'New debug session starting'); } catch { /* ignore */ }
  }
  activeConnections.clear();
  dapLog('[dap-proxy] All existing DAP connections closed');
}

/**
 * Attach the DAP proxy WebSocket server to an existing HTTP server.
 * @param {import('http').Server} server
 */
export function attachDapProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    dapLog(`[dap-proxy] Upgrade request for ${url.pathname}`);
    if (url.pathname !== '/dap') return; // let other upgrades pass through

    wss.handleUpgrade(req, socket, head, (ws) => {
      dapLog('[dap-proxy] WebSocket upgrade complete');
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const status = getDebugStatus();
    dapLog(`[dap-proxy] WS connection received. Debug status: ${JSON.stringify({ active: status.active, status: status.status, port: status.port, pid: status.pid })}`);

    if (!status.active || !status.port) {
      dapLog('[dap-proxy] No active debug session, closing WS');
      ws.close(4000, 'No active debug session');
      return;
    }

    const targetPort = status.port;
    dapLog(`[dap-proxy] Bridging WS to TCP 127.0.0.1:${targetPort}`);

    const tcp = net.createConnection({ host: '127.0.0.1', port: targetPort });

    // Track this connection
    activeConnections.add(ws);

    tcp.on('connect', () => {
      dapLog(`[dap-proxy] TCP connected to debugpy on port ${targetPort}`);
      // Transition debug state to 'running' now that a DAP client has connected
      setDebugRunning();
    });

    // WS → TCP
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      dapLog(`[dap-proxy] WS→TCP ${buf.length} bytes`);
      tcp.write(buf);
    });

    // TCP → WS
    tcp.on('data', (chunk) => {
      dapLog(`[dap-proxy] TCP→WS ${chunk.length} bytes`);
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    // Clean shutdown
    ws.on('close', (code, reason) => {
      dapLog(`[dap-proxy] WS closed code=${code} reason=${reason}`);
      activeConnections.delete(ws);
      tcp.destroy();
    });

    ws.on('error', (err) => {
      console.error('[dap-proxy] WS error:', err.message);
      tcp.destroy();
    });

    tcp.on('close', (hadError) => {
      dapLog(`[dap-proxy] TCP closed hadError=${hadError}`);
      if (ws.readyState === ws.OPEN) ws.close(1000);
    });

    tcp.on('error', (err) => {
      console.error(`[dap-proxy] TCP error: ${err.message} (code=${err.code})`);
      if (ws.readyState === ws.OPEN) ws.close(4001, `TCP error: ${err.message}`);
    });
  });

  dapLog('[dap-proxy] DAP WebSocket proxy registered on /dap');
}
