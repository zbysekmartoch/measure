/**
 * dap-client.js — Debug Adapter Protocol client over WebSocket.
 *
 * Handles:
 *   1. WebSocket transport (binary) to backend /dap proxy
 *   2. DAP Content-Length framing (encode/decode)
 *   3. DAP request/response/event protocol
 *   4. High-level session flow: initialize → attach → configurationDone
 *
 * Usage:
 *   const client = new DapClient('/dap');  // or 'ws://host/dap'
 *   client.on('stopped', (body) => { ... });
 *   await client.connect();
 *   await client.initialize();
 *   await client.attach();
 *   await client.setBreakpoints(source, breakpoints);
 *   await client.configurationDone();
 *   await client.continue(threadId);
 */

// ── DAP Content-Length framing ──────────────────────────────────────────────

const HEADER_SEPARATOR = '\r\n\r\n';
const CONTENT_LENGTH_RE = /Content-Length:\s*(\d+)/i;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Encode a DAP message (JS object) into Content-Length framed bytes.
 * @param {object} msg
 * @returns {Uint8Array}
 */
function encodeMessage(msg) {
  const json = JSON.stringify(msg);
  const body = ENCODER.encode(json);
  const header = ENCODER.encode(`Content-Length: ${body.length}${HEADER_SEPARATOR}`);
  const result = new Uint8Array(header.length + body.length);
  result.set(header, 0);
  result.set(body, header.length);
  return result;
}

/**
 * Incremental DAP message parser.
 * Feed it chunks via `feed(chunk)`, it calls `onMessage(obj)` for each complete message.
 */
class DapParser {
  constructor(onMessage) {
    this._onMessage = onMessage;
    this._buffer = new Uint8Array(0);
  }

  feed(chunk) {
    // Append chunk to buffer
    const newBuf = new Uint8Array(this._buffer.length + chunk.length);
    newBuf.set(this._buffer, 0);
    newBuf.set(chunk, this._buffer.length);
    this._buffer = newBuf;

    // Try to extract complete messages
    while (this._tryParse()) { /* keep parsing */ }
  }

  _tryParse() {
    // Look for header separator
    const text = DECODER.decode(this._buffer);
    const sepIdx = text.indexOf(HEADER_SEPARATOR);
    if (sepIdx === -1) return false;

    // Parse Content-Length from header
    const headerText = text.substring(0, sepIdx);
    const match = CONTENT_LENGTH_RE.exec(headerText);
    if (!match) return false;

    const contentLength = parseInt(match[1], 10);
    const headerBytes = ENCODER.encode(headerText + HEADER_SEPARATOR).length;
    const totalNeeded = headerBytes + contentLength;

    if (this._buffer.length < totalNeeded) return false;

    // Extract body
    const bodyBytes = this._buffer.slice(headerBytes, totalNeeded);
    const bodyStr = DECODER.decode(bodyBytes);

    // Consume from buffer
    this._buffer = this._buffer.slice(totalNeeded);

    try {
      const msg = JSON.parse(bodyStr);
      this._onMessage(msg);
    } catch (e) {
      console.error('[DapParser] Failed to parse JSON:', e, bodyStr);
    }

    return true;
  }
}

// ── DapClient ───────────────────────────────────────────────────────────────

export class DapClient {
  /**
   * @param {string} wsUrl — WebSocket URL (e.g., '/dap' or 'ws://host/dap')
   */
  constructor(wsUrl) {
    this._wsUrl = wsUrl;
    /** @type {WebSocket|null} */
    this._ws = null;
    this._parser = null;
    this._seq = 1;
    /** @type {Map<number, {resolve, reject}>} */
    this._pending = new Map();
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
    this._connected = false;
  }

  // ── Event emitter ──

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;
  }

  off(event, fn) {
    const arr = this._listeners.get(event);
    if (arr) this._listeners.set(event, arr.filter(f => f !== fn));
    return this;
  }

  _emit(event, data) {
    const arr = this._listeners.get(event);
    if (arr) arr.forEach(fn => { try { fn(data); } catch (e) { console.error('[DapClient] listener error:', e); } });
  }

  // ── Transport ──

  connect() {
    return new Promise((resolve, reject) => {
      // Build absolute WS URL if relative
      let url = this._wsUrl;
      if (url.startsWith('/')) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        url = `${proto}//${location.host}${url}`;
      }

      console.log(`[DapClient] Connecting to ${url}`);
      this._ws = new WebSocket(url);
      this._ws.binaryType = 'arraybuffer';

      this._parser = new DapParser((msg) => this._handleMessage(msg));

      this._ws.onopen = () => {
        console.log('[DapClient] WebSocket open');
        this._connected = true;
        this._emit('connected', null);
        resolve();
      };

      this._ws.onmessage = (ev) => {
        const data = ev.data;
        const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : ENCODER.encode(data);
        console.log(`[DapClient] WS received ${chunk.length} bytes`);
        this._parser.feed(chunk);
      };

      this._ws.onclose = (ev) => {
        console.log(`[DapClient] WebSocket closed code=${ev.code} reason=${ev.reason}`);
        this._connected = false;
        this._emit('disconnected', { code: ev.code, reason: ev.reason });
        // Reject all pending requests
        for (const [, p] of this._pending) {
          p.reject(new Error('WebSocket closed'));
        }
        this._pending.clear();
      };

      this._ws.onerror = (ev) => {
        console.error('[DapClient] WebSocket error:', ev);
        this._emit('error', ev);
        if (!this._connected) reject(new Error('WebSocket connection failed'));
      };
    });
  }

  disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._connected = false;
  }

  get connected() { return this._connected; }

  // ── Protocol ──

  _send(msg) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const encoded = encodeMessage(msg);
    console.log(`[DapClient] Sending ${encoded.length} bytes: ${msg.type}/${msg.command || msg.event || '?'} seq=${msg.seq}`);
    this._ws.send(encoded);
  }

  /**
   * Send a DAP request and wait for the response.
   * @param {string} command
   * @param {object} [args]
   * @returns {Promise<object>} response body
   */
  request(command, args = {}) {
    return new Promise((resolve, reject) => {
      const seq = this._seq++;
      const msg = {
        seq,
        type: 'request',
        command,
        arguments: args,
      };

      this._pending.set(seq, { resolve, reject });
      try {
        this._send(msg);
      } catch (e) {
        this._pending.delete(seq);
        reject(e);
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this._pending.has(seq)) {
          this._pending.delete(seq);
          reject(new Error(`DAP request ${command} timed out`));
        }
      }, 30000);
    });
  }

  _handleMessage(msg) {
    console.log(`[DapClient] Received: ${msg.type}/${msg.command || msg.event || '?'} seq=${msg.seq} request_seq=${msg.request_seq || '-'}`, msg.success !== undefined ? `success=${msg.success}` : '');
    if (msg.type === 'response') {
      const pending = this._pending.get(msg.request_seq);
      if (pending) {
        this._pending.delete(msg.request_seq);
        if (msg.success) {
          pending.resolve(msg.body || {});
        } else {
          pending.reject(new Error(msg.message || `DAP error: ${msg.command}`));
        }
      }
      this._emit('response', msg);
    } else if (msg.type === 'event') {
      this._emit(msg.event, msg.body || {});
      this._emit('event', msg);
    }
  }

  // ── High-level DAP commands ──

  async initialize() {
    return this.request('initialize', {
      clientID: 'measure-debugger',
      clientName: 'Measure Lab Debugger',
      adapterID: 'debugpy',
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
    });
  }

  async attach() {
    return this.request('attach', {
      // debugpy attach — the server is already listening
      justMyCode: false,
    });
  }

  async configurationDone() {
    return this.request('configurationDone');
  }

  /**
   * Set breakpoints for a source file.
   * @param {string} sourcePath — absolute path on the backend filesystem
   * @param {number[]} lines — 1-based line numbers
   */
  async setBreakpoints(sourcePath, lines) {
    return this.request('setBreakpoints', {
      source: { path: sourcePath },
      breakpoints: lines.map(line => ({ line })),
    });
  }

  async continue(threadId) {
    return this.request('continue', { threadId });
  }

  async next(threadId) {
    return this.request('next', { threadId });
  }

  async stepIn(threadId) {
    return this.request('stepIn', { threadId });
  }

  async stepOut(threadId) {
    return this.request('stepOut', { threadId });
  }

  async pause(threadId) {
    return this.request('pause', { threadId });
  }

  async threads() {
    return this.request('threads');
  }

  async stackTrace(threadId, startFrame = 0, levels = 50) {
    return this.request('stackTrace', { threadId, startFrame, levels });
  }

  async scopes(frameId) {
    return this.request('scopes', { frameId });
  }

  async variables(variablesReference, start, count) {
    const args = { variablesReference };
    if (start !== undefined) args.start = start;
    if (count !== undefined) args.count = count;
    return this.request('variables', args);
  }

  async evaluate(expression, frameId, context = 'hover') {
    return this.request('evaluate', { expression, frameId, context });
  }

  async disconnectDap(restart = false) {
    try {
      await this.request('disconnect', { restart });
    } catch { /* ignore */ }
    this.disconnect();
  }
}

export default DapClient;
