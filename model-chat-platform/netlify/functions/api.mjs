const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
import { CONTENT_COPILOT_MODE, withContentCopilot } from "../../lib/content-copilot.mjs";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 110000);
export const config = { stream: true };
const json = (statusCode, data, extraHeaders = {}) => ({ statusCode, headers: { ...JSON_HEADERS, ...extraHeaders }, body: JSON.stringify(data) });

function route(event) { return (event.path || "/").replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api(?=\/|$)/, "") || "/"; }
function models() { try { return JSON.parse(process.env.TEAM_MODELS || "[{\"value\":\"gpt-6-astra\",\"label\":\"6 Astra\"},{\"value\":\"gpt-5.6-sol\",\"label\":\"5.6 Sol\"},{\"value\":\"gpt-5.6-terra\",\"label\":\"5.6 Terra\"},{\"value\":\"gpt-5.6-luna\",\"label\":\"5.6 Luna\"}]"); } catch { return []; } }
function transient(status) { return [502, 503, 504].includes(status); }
function parseError(raw) { try { const data = JSON.parse(raw); return data?.error?.message || data?.error || data?.message || "模型接口调用失败"; } catch { return raw.slice(0, 1000) || "模型接口调用失败"; } }
function typedError(message, code) { return Object.assign(new Error(message), { code }); }
function errorPayload(error) {
  if (error?.code === "ATTACHMENT_TOO_LARGE") return { error: error.message, errorType: error.code };
  if (error?.code === "UPSTREAM_TIMEOUT" || error?.name === "AbortError") return { error: "上游模型响应超时，请减少附件或拆分复杂任务后重试。", errorType: "UPSTREAM_TIMEOUT" };
  if (error?.code === "NETWORK_ERROR") return { error: "临时网络错误，请稍后重试。", errorType: error.code };
  return { error: error?.message || "服务异常", errorType: error?.code || "SERVER_ERROR" };
}
async function fetchUpstream(endpoint, requestBody, apiKey) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(requestBody), signal: controller.signal });
      clearTimeout(timer);
      if (response.ok || !transient(response.status) || attempt === 1) return response;
      lastError = typedError(`上游暂时不可用（${response.status}）`, "UPSTREAM_API_ERROR");
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === "AbortError" ? typedError("上游模型响应超时", "UPSTREAM_TIMEOUT") : typedError("临时网络错误", "NETWORK_ERROR");
      if (attempt === 1) throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw lastError || typedError("模型接口调用失败", "UPSTREAM_API_ERROR");
}
function validate(body, raw) {
  if (Buffer.byteLength(raw || "", "utf8") > MAX_REQUEST_BYTES) throw typedError("附件总大小超过 8 MB 限制，请压缩或拆分后再上传。", "ATTACHMENT_TOO_LARGE");
  const baseUrl = String(body.baseUrl || "").trim().replace(/\/$/, "");
  const apiKey = String(body.apiKey || "").trim();
  const model = String(body.model || "").trim();
  const messages = Array.isArray(body.messages) ? body.messages.slice(-50) : [];
  if (!baseUrl || !apiKey || !model || !messages.length) throw typedError("请完善接口地址、API Key 和模型", "INVALID_REQUEST");
  return { baseUrl, apiKey, model, messages, mode: body.mode === CONTENT_COPILOT_MODE ? CONTENT_COPILOT_MODE : "" };
}

function keepAliveStream(body) {
  const encoder = new TextEncoder();
  let timer;
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      timer = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\\n\\n")), 4000);
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        clearInterval(timer);
      }
    },
    cancel() {
      clearInterval(timer);
    }
  });
}

async function handleEvent(event) {
  const path = route(event);
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod === "GET" && (path === "/models" || event.queryStringParameters?.action === "models")) return json(200, { models: models() });
  if (event.httpMethod !== "POST") return json(404, { error: "接口不存在", errorType: "NOT_FOUND" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "{}");
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "请求格式无效", errorType: "INVALID_REQUEST" }); }
  try {
    const { baseUrl, apiKey, model, messages, mode } = validate(body, raw);
    const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    const upstream = await fetchUpstream(endpoint, { model, messages: withContentCopilot(messages, mode), temperature: Number.isFinite(+body.temperature) ? +body.temperature : 0.7, max_tokens: Number.isFinite(+body.maxTokens) ? +body.maxTokens : 4096, stream: true }, apiKey);
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok) {
      const rawError = await upstream.text();
      const htmlError = /^\s*<(?:!doctype|html)/i.test(rawError);
      return json(htmlError ? 502 : upstream.status, { error: htmlError ? "上游返回了 HTML 错误页" : parseError(rawError), errorType: htmlError ? "HTML_ERROR_PAGE" : "UPSTREAM_API_ERROR", upstreamStatus: upstream.status });
    }
    if (contentType.includes("text/event-stream") && upstream.body) return new Response(keepAliveStream(upstream.body), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-model": model } });
      const upstreamRaw = await upstream.text();
      if (/^\s*<(?:!doctype|html)/i.test(upstreamRaw)) return json(502, { error: "上游返回了 HTML 错误页", errorType: "HTML_ERROR_PAGE" });
      let payload;
      try { payload = JSON.parse(upstreamRaw); } catch { payload = {}; }
    return json(200, { content: payload?.choices?.[0]?.message?.content || payload?.output_text || "", model: payload?.model || model, usage: payload?.usage || null });
  } catch (error) {
    return json(error?.code === "ATTACHMENT_TOO_LARGE" ? 413 : error?.code === "INVALID_REQUEST" ? 400 : 500, errorPayload(error));
  }
};

// Netlify's modern runtime preserves a Web Response body for streaming.
export default async function netlifyRequest(request) {
  const url = new URL(request.url);
  const event = {
    httpMethod: request.method,
    path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
  };
  const result = await handleEvent(event);
  if (result instanceof Response) return result;
  return new Response(result.body || "", { status: result.statusCode || 200, headers: result.headers || JSON_HEADERS });
}
