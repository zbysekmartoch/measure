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
import { getDebugStatus } from './debug-engine.js';

/**
 * Attach the DAP proxy WebSocket server to an existing HTTP server.
 * @param {import('http').Server} server
 */
export function attachDapProxy(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(`[dap-proxy] Upgrade request for ${url.pathname}`);
    if (url.pathname !== '/dap') return; // let other upgrades pass through

    wss.handleUpgrade(req, socket, head, (ws) => {
      console.log('[dap-proxy] WebSocket upgrade complete');
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    const status = getDebugStatus();
    if (!status.active || !status.port) {
      console.log('[dap-proxy] No active debug session, closing WS');
      ws.close(4000, 'No active debug session');
      return;
    }

    const targetPort = status.port;
    console.log(`[dap-proxy] WS client connected, bridging to TCP 127.0.0.1:${targetPort}`);

    const tcp = net.createConnection({ host: '127.0.0.1', port: targetPort }, () => {
      console.log(`[dap-proxy] TCP connected to debugpy on port ${targetPort}`);
    });

    // WS → TCP
    ws.on('message', (data) => {
      // data can be Buffer or ArrayBuffer
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      tcp.write(buf);
    });

    // TCP → WS (send as binary)
    tcp.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    // Clean shutdown
    ws.on('close', () => {
      console.log('[dap-proxy] WS closed, destroying TCP');
      tcp.destroy();
    });

    ws.on('error', (err) => {
      console.error('[dap-proxy] WS error:', err.message);
      tcp.destroy();
    });

    tcp.on('close', () => {
      console.log('[dap-proxy] TCP closed, closing WS');
      if (ws.readyState === ws.OPEN) ws.close(1000);
    });

    tcp.on('error', (err) => {
      console.error('[dap-proxy] TCP error:', err.message);
      if (ws.readyState === ws.OPEN) ws.close(4001, 'TCP connection error');
    });
  });

  console.log('[dap-proxy] DAP WebSocket proxy registered on /dap');
}
