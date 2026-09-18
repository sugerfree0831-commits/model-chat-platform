const $ = (id) => document.getElementById(id);
const box = $("messages");
const messages = [];
let attachments = [];
let chats = JSON.parse(localStorage.getItem("modelHubChats") || "[]");
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp|gif|bmp|svg|heic|heif|avif|tiff?)$/i;
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|java|c|cc|cpp|h|hpp|go|rs|php|rb|swift|kt|kts|sql|sh|bash|zsh|yaml|yml|toml|ini|conf|log|rtf)$/i;
const DOCUMENT_PATTERN = /\.(pdf|doc|docx|odt|wps|xls|xlsx|ods|et|numbers|ppt|pptx|odp|dps|key)$/i;
const ARCHIVE_PATTERN = /\.(zip|rar|7z)$/i;
function md(value) { const source = Array.isArray(value) ? value.map((part) => typeof part === "string" ? part : part?.type === "text" ? part.text : part?.image_url ? "[图片附件]" : "").join("\n") : String(value ?? ""); return source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>"); }
function render() { box.innerHTML = messages.length ? messages.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join("") : `<div class="welcome"><div class="welcomeIcon">✦</div><h2>连接你的模型，开始工作</h2><p>在右侧填写接口信息。支持 OpenAI 兼容的 Chat Completions 网关。</p><button id="welcomeAction">配置模型 →</button></div>`; box.scrollTop = box.scrollHeight; $("welcomeAction")?.addEventListener("click", () => $("baseUrl").focus()); renderChats(); }
function renderChats() { const el = $("chatList"); el.innerHTML = chats.map((chat, index) => `<div class="chatItem" data-i="${index}">${md(chat.title || "新对话").replace(/<[^>]+>/g, "")}</div>`).join(""); el.querySelectorAll(".chatItem").forEach((item) => item.onclick = () => { messages.splice(0, messages.length, ...chats[+item.dataset.i].messages); $("title").textContent = chats[+item.dataset.i].title; render(); }); }
function selectedModel() { return $("model").value === "custom" ? $("customModel").value.trim() : $("model").value; }
function selectedMode() { return $("mode").value === "general" ? "general" : "brand-content"; }
function updateModeDisplay() { const enabled = selectedMode() === "brand-content"; $("modeBadge").hidden = !enabled; $("modeNote").textContent = enabled ? "自动应用你的内容判断标准、品牌知识、渠道规则与合规边界" : "不注入内容创作规则，按普通模型对话方式回答"; }
function save() { localStorage.setItem("modelHubConfig", JSON.stringify({ baseUrl: $("baseUrl").value, apiKey: $("apiKey").value, model: selectedModel(), mode: selectedMode(), temperature: $("temperature").value, maxTokens: $("maxTokens").value })); }
fetch("/.netlify/functions/api?action=models").then((r) => r.json()).then((data) => { if (!data.models) return; const select = $("model"); select.innerHTML = data.models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("") + '<option value="custom">自定义模型</option>'; const saved = JSON.parse(localStorage.getItem("modelHubConfig") || "{}"); if (saved.model && [...select.options].some((o) => o.value === saved.model)) select.value = saved.model; $("customModel").hidden = select.value !== "custom"; }).catch(() => {});
try { const config = JSON.parse(localStorage.getItem("modelHubConfig") || "{}"); for (const key of ["baseUrl", "apiKey", "model", "mode", "temperature", "maxTokens"]) if (config[key] != null && $(key)) $(key).value = config[key]; } catch {}
updateModeDisplay();
function showNotice(text) { $("notice").textContent = text; }
function formatBytes(bytes) { if (!bytes) return "0 KB"; return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fileLabel(file) { return file.webkitRelativePath || file.name; }
function fileExtension(name) { return name.includes(".") ? name.split(".").pop().toLowerCase() : "文件"; }
function isImageFile(file) { return file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name); }
function fileKind(file) {
  const extension = fileExtension(file.name);
  if (isImageFile(file)) return { className: "image", label: extension === "文件" ? "图片" : extension };
  if (["md", "markdown"].includes(extension)) return { className: "markdown", label: "MD" };
  if (extension === "pdf") return { className: "pdf", label: "PDF" };
  if (["doc", "docx", "odt", "wps"].includes(extension)) return { className: "word", label: "DOC" };
  if (["xls", "xlsx", "ods", "et", "numbers", "csv", "tsv"].includes(extension)) return { className: "sheet", label: ["csv", "tsv"].includes(extension) ? extension : "XLS" };
  if (["ppt", "pptx", "odp", "dps", "key"].includes(extension)) return { className: "slides", label: "PPT" };
  if (ARCHIVE_PATTERN.test(file.name)) return { className: "archive", label: extension };
  if (TEXT_FILE_PATTERN.test(file.name) || file.type.startsWith("text/")) return { className: "text", label: extension.slice(0, 4) };
  return { className: "file", label: extension.slice(0, 4) };
}
function renderAttachments() {
  const tray = $("attachmentStatus");
  tray.replaceChildren();
  for (const item of attachments) {
    const kind = fileKind(item);
    const chip = document.createElement("div");
    chip.className = "attachmentItem";
    const type = document.createElement("span");
    type.className = `fileType ${kind.className}`;
    type.textContent = kind.label;
    const meta = document.createElement("span");
    meta.className = "attachmentMeta";
    const name = document.createElement("span");
    name.className = "attachmentName";
    name.textContent = item.label;
    name.title = item.label;
    const size = document.createElement("span");
    size.className = "attachmentSize";
    size.textContent = formatBytes(item.size);
    const remove = document.createElement("button");
    remove.className = "attachmentRemove";
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${item.label}`);
    remove.title = "移除附件";
    remove.textContent = "×";
    remove.onclick = () => {
      attachments = attachments.filter((attachment) => attachment.id !== item.id);
      renderAttachments();
      updateSendState();
      showNotice(attachments.length ? `已添加 ${attachments.length} 个附件。` : "");
    };
    meta.append(name, size);
    chip.append(type, meta, remove);
    tray.append(chip);
  }
}
function readAsDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function readFiles(fileList) {
  const knownIds = new Set(attachments.map((item) => item.id));
  const files = [...fileList].filter((file) => !knownIds.has(`${fileLabel(file)}:${file.size}:${file.lastModified}`));
  if (!files.length) { showNotice("这些附件已经添加过了。"); return; }
  const currentTotal = attachments.reduce((sum, item) => sum + item.size, 0);
  const incomingTotal = files.reduce((sum, file) => sum + file.size, 0);
  if (currentTotal + incomingTotal > MAX_REQUEST_BYTES) { showNotice(`附件合计 ${formatBytes(currentTotal + incomingTotal)}，超过 8 MB 限制，请减少文件后重试。`); return; }
  const rejected = [];
  for (const file of files) {
    const label = fileLabel(file);
    const id = `${label}:${file.size}:${file.lastModified}`;
    if (knownIds.has(id)) continue;
    if (file.size > MAX_FILE_BYTES) { rejected.push(`${label} 超过 5 MB`); continue; }
    let data;
    const image = isImageFile(file);
    if (image) data = await readAsDataUrl(file);
    else if (file.type.startsWith("text/") || TEXT_FILE_PATTERN.test(file.name)) data = `[文件：${label}]\n${await file.text()}`;
    else if (DOCUMENT_PATTERN.test(file.name)) data = `[文档附件：${label}（${formatBytes(file.size)}）]`;
    else if (ARCHIVE_PATTERN.test(file.name)) data = `[压缩包附件：${label}（${formatBytes(file.size)}）]`;
    else data = `[附件：${label}（${file.type || "未知类型"}，${formatBytes(file.size)}）]`;
    attachments.push({ id, name: file.name, label, type: file.type || "application/octet-stream", size: file.size, data, kind: image ? "image" : "file" });
    knownIds.add(id);
  }
  renderAttachments();
  updateSendState();
  const total = attachments.reduce((sum, item) => sum + item.size, 0);
  showNotice(rejected.length ? `${rejected.join("；")}，其余附件已添加。` : `已添加 ${attachments.length} 个附件，共 ${formatBytes(total)}。`);
}
async function addFiles(fileList) { try { await readFiles(fileList); } catch { showNotice("文件读取失败，请重新选择或更换文件。"); } }
$("chooseFile").onclick = () => $("file").click();
$("file").onchange = async () => { await addFiles($("file").files); $("file").value = ""; };
function transient(status) { return [502, 503, 504].includes(status); }
function friendlyError(data, status) { if (data?.errorType === "ATTACHMENT_TOO_LARGE" || status === 413) return data.error || "附件过大，请拆分后重试。"; if (data?.errorType === "UPSTREAM_TIMEOUT") return data.error || "上游模型响应超时，请拆分复杂任务后重试。"; if (data?.errorType === "UPSTREAM_API_ERROR") return `上游 API 错误（${data.upstreamStatus || status}）：${data.error}`; if (data?.errorType === "HTML_ERROR_PAGE") return "Netlify Function 返回了 HTML 错误页，请确认 Functions 已部署。"; return data?.error || (transient(status) ? `服务暂时不可用（${status}），已自动重试一次。` : "调用失败"); }
async function streamResponse(response, onDelta) { if (!response.body) throw new Error("响应没有可读取的流"); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "", full = ""; const consume = (chunk) => { buffer += chunk; const events = buffer.split(/\n\n/); buffer = events.pop() || ""; for (const event of events) { const line = event.split("\n").find((item) => item.startsWith("data:")); if (!line) continue; const data = line.slice(5).trim(); if (data === "[DONE]") continue; try { const payload = JSON.parse(data); const delta = payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || payload.output_text || ""; if (delta) { full += delta; onDelta(delta, full); } } catch {} } }; while (true) { const { value, done } = await reader.read(); if (done) break; consume(decoder.decode(value, { stream: true })); } consume(decoder.decode()); return full; }
async function requestWithRetry(payload) { let last; for (let attempt = 0; attempt < 2; attempt += 1) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120000); try { const response = await window.fetch("/.netlify/functions/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal }); clearTimeout(timer); const contentType = response.headers.get("content-type") || ""; if (response.ok) return { response, contentType }; const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = { errorType: raw.trim().startsWith("<") ? "HTML_ERROR_PAGE" : "SERVER_ERROR", error: raw.slice(0, 500) }; } last = new Error(friendlyError(data, response.status)); last.retryable = transient(response.status); if (!last.retryable || attempt === 1) throw last; } catch (error) { clearTimeout(timer); if (error === last && last?.retryable === false) throw error; last = error?.name === "AbortError" ? new Error("Netlify 或网络请求超时，请减少附件或拆分复杂任务后重试。") : error; if (attempt === 1) throw last; } await new Promise((resolve) => setTimeout(resolve, 700)); } throw last || new Error("调用失败"); }
$("form").onsubmit = async (event) => { event.preventDefault(); const text = $("input").value.trim(); if (!text && !attachments.length) return; const cfg = { baseUrl: $("baseUrl").value, apiKey: $("apiKey").value, model: selectedModel(), mode: selectedMode(), temperature: $("temperature").value, maxTokens: $("maxTokens").value }; if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) { showNotice("请先完善右侧连接设置"); return; } const documentText = attachments.filter((item) => item.kind !== "image").map((item) => item.data).join("\n\n"); const imageParts = attachments.filter((item) => item.kind === "image").map((item) => ({ type: "image_url", image_url: { url: item.data } })); const combinedText = [text, documentText].filter(Boolean).join("\n\n"); const content = imageParts.length ? [{ type: "text", text: combinedText }, ...imageParts] : combinedText; messages.push({ role: "user", content }, { role: "assistant", content: "" }); const assistant = messages[messages.length - 1]; attachments = []; $("file").value = ""; renderAttachments(); $("input").value = ""; resizeInput(); updateSendState(); render(); $("connection").textContent = "请求中…"; save(); try { const { response, contentType } = await requestWithRetry({ ...cfg, messages: messages.slice(0, -1) }); if (contentType.includes("text/event-stream")) await streamResponse(response, (_delta, full) => { assistant.content = full; render(); }); else { const data = await response.json(); assistant.content = data.content || "模型未返回内容"; render(); } $("connection").textContent = `已连接 · ${response.headers.get("x-model") || cfg.model}`; const firstUserMessage = messages.find((message) => message.role === "user")?.content; const titleSource = Array.isArray(firstUserMessage) ? firstUserMessage.find((part) => part.type === "text")?.text : firstUserMessage; const title = String(titleSource || "新对话").replace(/\n/g, " ").slice(0, 24); chats = [{ title, messages: structuredClone(messages) }, ...chats.filter((chat) => chat.title !== title)].slice(0, 30); localStorage.setItem("modelHubChats", JSON.stringify(chats)); } catch (error) { assistant.content = `调用失败：${error.message}`; $("connection").textContent = "连接失败"; render(); } };
const inputBox = $("input");
function resizeInput() { inputBox.style.height = "auto"; inputBox.style.height = `${Math.min(inputBox.scrollHeight, 180)}px`; }
function updateSendState() { $("send").disabled = !inputBox.value.trim() && !attachments.length; }
inputBox.addEventListener("input", () => { resizeInput(); updateSendState(); });
resizeInput();
updateSendState();
inputBox.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("form").requestSubmit(); } });
inputBox.addEventListener("paste", (event) => { const files = [...(event.clipboardData?.files || [])]; if (files.length) addFiles(files); });
const composer = $("form");
for (const eventName of ["dragenter", "dragover"]) composer.addEventListener(eventName, (event) => { event.preventDefault(); composer.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) composer.addEventListener(eventName, (event) => { event.preventDefault(); composer.classList.remove("dragging"); });
composer.addEventListener("drop", (event) => addFiles(event.dataTransfer?.files || []));
$("test").onclick = () => { inputBox.value = "你好，请回复“连接成功”"; updateSendState(); $("form").requestSubmit(); };
$("newChat").onclick = () => { messages.length = 0; attachments = []; $("file").value = ""; renderAttachments(); updateSendState(); showNotice(""); render(); $("title").textContent = "新对话"; $("connection").textContent = "未连接"; };
$("model").onchange = () => { $("customModel").hidden = $("model").value !== "custom"; save(); };
$("mode").onchange = () => { updateModeDisplay(); save(); };
["baseUrl", "apiKey", "model", "customModel", "temperature", "maxTokens"].forEach((id) => $(id).addEventListener("change", save));
render();
