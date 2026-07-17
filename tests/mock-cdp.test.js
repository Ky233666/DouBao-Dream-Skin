"use strict";

const assert = require("assert");
const crypto = require("crypto");
const http = require("http");
const { CdpClient, httpGetJson, validateDebuggerUrl } = require("../scripts/cdp-client");

function serverFrame(opcode, payload, fin) {
  const body = Buffer.from(payload, "utf8");
  const header = body.length < 126 ? Buffer.alloc(2) : Buffer.alloc(4);
  header[0] = (fin === false ? 0 : 0x80) | opcode;
  if (body.length < 126) header[1] = body.length;
  else {
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  }
  return Buffer.concat([header, body]);
}

function consumeClientFrames(socket, onMessage) {
  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 0x0f;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        if (buffered.readUInt32BE(2) !== 0) throw new Error("Test frame too large");
        length = buffered.readUInt32BE(6);
        offset = 10;
      }
      const masked = Boolean(buffered[1] & 0x80);
      assert.strictEqual(masked, true, "client frames must be masked");
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.slice(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffered.slice(offset, offset + length));
      buffered = buffered.slice(offset + length);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 1) onMessage(payload.toString("utf8"));
    }
  });
}

async function main() {
  const targetId = "mock-page-1";
  const browserId = "mock-browser-1";
  const sockets = new Set();
  let port = null;
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/json/version") {
      response.end(JSON.stringify({ Browser: "MockChromium/135", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}` }));
    } else if (request.url === "/json/list") {
      response.end(JSON.stringify([{ id: targetId, type: "page", url: "https://www.doubao.com/chat/", webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${targetId}` }]));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));
    consumeClientFrames(socket, (text) => {
      const command = JSON.parse(text);
      const response = JSON.stringify({
        id: command.id,
        result: command.method === "Runtime.evaluate" ? { result: { value: { ok: true, echo: command.params.expression } } } : {},
      });
      const splitAt = Math.max(1, Math.floor(response.length / 2));
      socket.write(serverFrame(1, response.slice(0, splitAt), false));
      socket.write(serverFrame(0, response.slice(splitAt), true));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  try {
    const version = await httpGetJson(port, "/json/version", 2000);
    assert.strictEqual(version.Browser, "MockChromium/135");
    assert.throws(() => validateDebuggerUrl("ws://192.168.1.8:9222/devtools/page/x", 9222, new Set(["page"])));
    const client = await new CdpClient(`ws://127.0.0.1:${port}/devtools/page/${targetId}`, port, 3000).connect();
    await client.send("Runtime.enable");
    const evaluated = await client.evaluate("40 + 2");
    assert.deepStrictEqual(evaluated, { ok: true, echo: "40 + 2" });
    client.close();
    console.log(JSON.stringify({ ok: true, test: "mock-cdp", port }, null, 2));
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
