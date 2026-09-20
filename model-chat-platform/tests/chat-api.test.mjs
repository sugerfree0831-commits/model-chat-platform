import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import test from "node:test";

import netlifyHandler from "../netlify/functions/api.mjs";
import { handleApi } from "../server.js";

const message = { role: "user", content: [{ type: "text", text: "检查附件" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] };

function sseResponse(reason = "stop") {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "完整回复" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`,
    "data: [DONE]\n\n"
  ].join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function localRequest(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: options.method || "GET", headers: options.headers || {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("Netlify stream uses the unified token default and preserves copilot attachments", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamBody;
  globalThis.fetch = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return sseResponse("length");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await netlifyHandler(new Request("https://chat.example/.netlify/functions/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "https://gateway.example/v1", apiKey: "secret", model: "gpt-test", mode: "brand-content", messages: [message] })
  }));
  const stream = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(upstreamBody.max_tokens, 32000);
  assert.equal(upstreamBody.messages[0].role, "system");
  assert.deepEqual(upstreamBody.messages.at(-1), message);
  assert.match(stream, /"finish_reason":"length"/);
  assert.match(stream, /data: \[DONE\]\n\n$/);
});

test("Netlify non-stream response exposes finish reason and clamps output tokens", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamBody;
  globalThis.fetch = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return Response.json({ model: "gpt-test", choices: [{ message: { content: "结果" }, finish_reason: "length" }], usage: { completion_tokens: 32000 } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await netlifyHandler(new Request("https://chat.example/.netlify/functions/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "https://gateway.example/v1", apiKey: "secret", model: "gpt-test", maxTokens: 99999, messages: [{ role: "user", content: "测试" }] })
  }));
  const payload = await response.json();

  assert.equal(upstreamBody.max_tokens, 32000);
  assert.equal(payload.finishReason, "length");
  assert.equal(response.headers.get("x-model"), "gpt-test");
});

test("local server supports the same Netlify endpoint used by the browser", async (t) => {
  const originalFetch = globalThis.fetch;
  let upstreamBody;
  globalThis.fetch = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return sseResponse("stop");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const server = createServer((req, res) => handleApi(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const body = JSON.stringify({ baseUrl: "https://gateway.example/v1", apiKey: "secret", model: "gpt-test", messages: [{ role: "user", content: "测试" }] });
  const response = await localRequest(port, "/.netlify/functions/api", { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body });

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-model"], "gpt-test");
  assert.equal(upstreamBody.max_tokens, 32000);
  assert.match(response.body, /data: \[DONE\]/);
});
