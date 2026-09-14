const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const json = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });

function route(event) {
  return (event.path || "/")
    .replace(/^\/\.netlify\/functions\/api/, "")
    .replace(/^\/api(?=\/|$)/, "") || "/";
}

function models() {
  try {
    return JSON.parse(process.env.TEAM_MODELS || "[{\"value\":\"gpt-6-astra\",\"label\":\"6 Astra\"},{\"value\":\"gpt-5.6-sol\",\"label\":\"5.6 Sol\"},{\"value\":\"gpt-5.6-terra\",\"label\":\"5.6 Terra\"},{\"value\":\"gpt-5.6-luna\",\"label\":\"5.6 Luna\"}]");
  } catch {
    return [];
  }
}

export const handler = async (event) => {
  try {
    const path = route(event);
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (event.httpMethod === "GET" && (path === "/models" || event.queryStringParameters?.action === "models")) return json(200, { models: models() });
    if (event.httpMethod !== "POST") return json(404, { error: "接口不存在" });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "请求格式无效" }); }
    const baseUrl = String(body.baseUrl || "").trim().replace(/\/$/, "");
    const apiKey = String(body.apiKey || "").trim();
    const model = String(body.model || "").trim();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-50) : [];
    if (!baseUrl || !apiKey || !model || !messages.length) return json(400, { error: "请完善接口地址、API Key 和模型" });
    const endpoint = (/\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`);
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: Number.isFinite(+body.temperature) ? +body.temperature : 0.7, max_tokens: Number.isFinite(+body.maxTokens) ? +body.maxTokens : 2048, stream: false })
    });
    const raw = await upstream.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { error: raw.slice(0, 1000) }; }
    if (!upstream.ok) return json(upstream.status, { error: payload?.error?.message || payload?.error || "模型接口调用失败" });
    return json(200, { content: (payload?.choices?.[0]?.message?.content || payload?.output_text || ""), model: payload?.model || model, usage: payload?.usage || null });
  } catch (error) {
    return json(500, { error: error.message || "服务异常" });
  }
};

export default { handler };
