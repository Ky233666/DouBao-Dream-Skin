"use strict";

const crypto = require("crypto");
const http = require("http");
const net = require("net");
const { EventEmitter } = require("events");

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

function httpGetJson(port, resource, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: resource,
        timeout: timeoutMs || 2500,
        headers: { Accept: "application/json" },
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > MAX_FRAME_BYTES) {
            response.destroy(new Error("CDP JSON response is unexpectedly large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`CDP HTTP ${response.statusCode} for ${resource}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(new Error(`Invalid CDP JSON from ${resource}: ${error.message}`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`CDP HTTP timeout for ${resource}`)));
    request.on("error", reject);
  });
}

function validateDebuggerUrl(rawUrl, expectedPort, allowedKinds) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error("CDP returned an invalid WebSocket URL");
  }
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  const pathMatch = parsed.pathname.match(/^\/devtools\/(page|browser)\/([A-Za-z0-9._-]{1,240})$/);
  if (
    parsed.protocol !== "ws:" ||
    !allowedHosts.has(parsed.hostname) ||
    Number(parsed.port) !== Number(expectedPort) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !pathMatch ||
    (allowedKinds && !allowedKinds.has(pathMatch[1]))
  ) {
    throw new Error("Rejected a CDP WebSocket URL outside the expected loopback endpoint");
  }
  return { url: parsed, kind: pathMatch[1], id: pathMatch[2] };
}

function encodeClientFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "", "utf8");
  if (body.length > MAX_FRAME_BYTES) throw new Error("WebSocket frame is too large");
  const mask = crypto.randomBytes(4);
  let headerLength = 2;
  if (body.length >= 126 && body.length <= 0xffff) headerLength += 2;
  else if (body.length > 0xffff) headerLength += 8;
  const frame = Buffer.allocUnsafe(headerLength + 4 + body.length);
  frame[0] = 0x80 | (opcode & 0x0f);
  let offset;
  if (body.length < 126) {
    frame[1] = 0x80 | body.length;
    offset = 2;
  } else if (body.length <= 0xffff) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(body.length, 2);
    offset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(body.length, 6);
    offset = 10;
  }
  mask.copy(frame, offset);
  offset += 4;
  for (let index = 0; index < body.length; index += 1) {
    frame[offset + index] = body[index] ^ mask[index % 4];
  }
  return frame;
}

class SimpleWebSocket extends EventEmitter {
  constructor(rawUrl, options) {
    super();
    this.url = new URL(rawUrl);
    this.timeoutMs = options?.timeoutMs || 5000;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.opened = false;
    this.closed = false;
    this.fragmentOpcode = null;
    this.fragments = [];
    this.fragmentLength = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.url.protocol !== "ws:") {
        reject(new Error("Only loopback ws:// CDP endpoints are supported"));
        return;
      }
      const key = crypto.randomBytes(16).toString("base64");
      const expectedAccept = crypto.createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64");
      let handshakeBuffer = Buffer.alloc(0);
      let settled = false;
      const socket = net.createConnection({ host: this.url.hostname, port: Number(this.url.port) });
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.destroy();
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection timed out"));
        }
      }, this.timeoutMs);

      const fail = (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          this.emit("error", error);
        }
      };

      socket.once("connect", () => {
        const hostHeader = `${this.url.hostname}:${this.url.port}`;
        const request = [
          `GET ${this.url.pathname} HTTP/1.1`,
          `Host: ${hostHeader}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n");
        socket.write(request, "ascii");
      });

      socket.on("data", (chunk) => {
        if (!this.opened) {
          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
          if (handshakeBuffer.length > 64 * 1024) {
            fail(new Error("WebSocket handshake is unexpectedly large"));
            socket.destroy();
            return;
          }
          const marker = handshakeBuffer.indexOf("\r\n\r\n");
          if (marker < 0) return;
          const headerText = handshakeBuffer.slice(0, marker).toString("latin1");
          const lines = headerText.split("\r\n");
          const headers = new Map();
          for (const line of lines.slice(1)) {
            const separator = line.indexOf(":");
            if (separator > 0) headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
          }
          if (!/^HTTP\/1\.[01] 101\b/.test(lines[0]) || headers.get("sec-websocket-accept") !== expectedAccept) {
            fail(new Error(`WebSocket upgrade failed: ${lines[0] || "empty response"}`));
            socket.destroy();
            return;
          }
          clearTimeout(timer);
          this.opened = true;
          if (!settled) {
            settled = true;
            resolve(this);
          }
          const remaining = handshakeBuffer.slice(marker + 4);
          handshakeBuffer = Buffer.alloc(0);
          if (remaining.length) this._consume(remaining);
          return;
        }
        this._consume(chunk);
      });

      socket.on("error", fail);
      socket.on("close", () => {
        clearTimeout(timer);
        this.closed = true;
        this.emit("close");
      });
    });
  }

  _consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        if (high !== 0) {
          this.destroy(new Error("WebSocket frame exceeds the supported size"));
          return;
        }
        length = low;
        offset = 10;
      }
      if (length > MAX_FRAME_BYTES) {
        this.destroy(new Error("WebSocket frame exceeds the safety limit"));
        return;
      }
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      let mask = null;
      if (masked) {
        mask = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }
      const payload = Buffer.from(this.buffer.slice(offset, offset + length));
      this.buffer = this.buffer.slice(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      this._handleFrame(fin, opcode, payload);
    }
  }

  _handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      if (!this.closed && this.socket?.writable) this.socket.write(encodeClientFrame(0x8, payload));
      this.socket?.end();
      return;
    }
    if (opcode === 0x9) {
      if (this.socket?.writable) this.socket.write(encodeClientFrame(0xA, payload));
      return;
    }
    if (opcode === 0xA) return;
    if (opcode !== 0 && opcode !== 1 && opcode !== 2) {
      this.destroy(new Error(`Unsupported WebSocket opcode: ${opcode}`));
      return;
    }
    if (opcode === 1 || opcode === 2) {
      this.fragmentOpcode = opcode;
      this.fragments = [];
      this.fragmentLength = 0;
    } else if (this.fragmentOpcode === null) {
      this.destroy(new Error("Unexpected WebSocket continuation frame"));
      return;
    }
    this.fragments.push(payload);
    this.fragmentLength += payload.length;
    if (this.fragmentLength > MAX_FRAME_BYTES) {
      this.destroy(new Error("Fragmented WebSocket message exceeds the safety limit"));
      return;
    }
    if (!fin) return;
    const message = Buffer.concat(this.fragments, this.fragmentLength);
    const messageOpcode = this.fragmentOpcode;
    this.fragmentOpcode = null;
    this.fragments = [];
    this.fragmentLength = 0;
    this.emit("message", messageOpcode === 1 ? message.toString("utf8") : message);
  }

  sendText(text) {
    if (!this.opened || this.closed || !this.socket?.writable) throw new Error("WebSocket is not open");
    this.socket.write(encodeClientFrame(0x1, Buffer.from(text, "utf8")));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.socket?.writable) this.socket.write(encodeClientFrame(0x8, Buffer.alloc(0)));
      this.socket?.end();
    } catch (_) {
      this.socket?.destroy();
    }
  }

  destroy(error) {
    if (error) this.emit("error", error);
    this.closed = true;
    this.socket?.destroy();
  }
}

class CdpClient {
  constructor(debuggerUrl, port, timeoutMs) {
    const validated = validateDebuggerUrl(debuggerUrl, port, new Set(["page", "browser"]));
    this.url = validated.url.href;
    this.timeoutMs = timeoutMs || 10000;
    this.socket = new SimpleWebSocket(this.url, { timeoutMs: Math.min(this.timeoutMs, 5000) });
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await this.socket.connect();
    this.socket.on("message", (text) => this._onMessage(text));
    this.socket.on("error", (error) => this._failAll(error));
    this.socket.on("close", () => this._failAll(new Error("CDP WebSocket closed")));
    return this;
  }

  _onMessage(text) {
    let message;
    try {
      message = JSON.parse(String(text));
    } catch (_) {
      this._failAll(new Error("CDP returned an invalid JSON message"));
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
    else pending.resolve(message.result || {});
  }

  _failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.sendText(JSON.stringify({ id, method, params: params || {} }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown error";
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
    this._failAll(new Error("CDP client closed"));
  }
}

module.exports = {
  CdpClient,
  SimpleWebSocket,
  encodeClientFrame,
  httpGetJson,
  validateDebuggerUrl,
};
