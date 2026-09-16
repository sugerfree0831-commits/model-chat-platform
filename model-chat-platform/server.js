import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 110000);
const transient = (status) => [502, 503, 504].includes(status);
async function body(req) { let value = ""; for await (const chunk of req) { value += chunk; if (value.length > 8 * 1024 * 1024) throw Object.assign(new Error("附件总大小超过 8 MB 限制"), { status: 413 }); } return JSON.parse(value || "{}"); }
function json(res, status, data, headers = {}) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(JSON.stringify(data)); }
async function upstream(endpoint, requestBody, key) { let last; for (let attempt = 0; attempt < 2; attempt += 1) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(requestBody), signal: controller.signal }); clearTimeout(timer); if (response.ok || !transient(response.status) || attempt === 1) return response; last = new Error(`上游暂时不可用（${response.status}）`); } catch (error) { clearTimeout(timer); last = error.name === "AbortError" ? Object.assign(new Error("上游模型响应超时"), { code: "UPSTREAM_TIMEOUT" }) : Object.assign(new Error("临时网络错误"), { code: "NETWORK_ERROR" }); if (attempt === 1) throw last; } await new Promise((resolve) => setTimeout(resolve, 350)); } throw last; }
async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/models") return json(res, 200, { models: JSON.parse(process.env.TEAM_MODELS || "[{\"value\":\"gpt-6-astra\",\"label\":\"6 Astra\"},{\"value\":\"gpt-5.6-sol\",\"label\":\"5.6 Sol\"},{\"value\":\"gpt-5.6-terra\",\"label\":\"5.6 Terra\"},{\"value\":\"gpt-5.6-luna\",\"label\":\"5.6 Luna\"}]") });
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const data = await body(req); const base = String(data.baseUrl || "").trim().replace(/\/$/, ""); const key = String(data.apiKey || "").trim(); const model = String(data.model || "").trim(); const messages = Array.isArray(data.messages) ? data.messages.slice(-50) : [];
      if (!base || !key || !model || !messages.length) return json(res, 400, { error: "请填写接口地址、API Key、模型并发送消息", errorType: "INVALID_REQUEST" });
      const response = await upstream(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`, { model, messages, temperature: Number.isFinite(+data.temperature) ? +data.temperature : 0.7, max_tokens: Number.isFinite(+data.maxTokens) ? +data.maxTokens : 2048, stream: true }, key);
      if (!response.ok) { const rawError = await response.text(); const htmlError = /^\s*<(?:!doctype|html)/i.test(rawError); return json(res, htmlError ? 502 : response.status, { error: htmlError ? "上游返回了 HTML 错误页" : rawError, errorType: htmlError ? "HTML_ERROR_PAGE" : "UPSTREAM_API_ERROR" }); }
      if ((response.headers.get("content-type") || "").includes("text/event-stream") && response.body) { res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }); for await (const chunk of response.body) res.write(chunk); return res.end(); }
      const raw = await response.text(); if (/^\s*<(?:!doctype|html)/i.test(raw)) return json(res, 502, { error: "上游返回了 HTML 错误页", errorType: "HTML_ERROR_PAGE" }); const payload = JSON.parse(raw); return json(res, 200, { content: payload?.choices?.[0]?.message?.content || payload?.output_text || "", model: payload?.model || model, usage: payload?.usage || null });
    } catch (error) { return json(res, error.status || 500, { error: error.message || "服务异常", errorType: error.code || "SERVER_ERROR" }); }
  }
  if (req.method === "GET") { const path = url.pathname === "/" ? "/index.html" : url.pathname; try { const data = await readFile(join(publicDir, path)); res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }); return res.end(data); } catch { res.writeHead(404); return res.end("Not found"); } }
  return json(res, 404, { error: "接口不存在" });
}
export { handler as handleApi };
if (process.argv[1] === fileURLToPath(import.meta.url)) { createServer((req, res) => handler(req, res).catch((error) => json(res, 500, { error: error.message || "服务异常" }))).listen(process.env.PORT || 4180, process.env.HOST || "127.0.0.1", () => console.log("模型对话平台已启动")); }
