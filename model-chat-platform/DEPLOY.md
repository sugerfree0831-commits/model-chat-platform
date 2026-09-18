# 部署到 Netlify

1. 将 `model-chat-platform` 目录上传到 Netlify（Add new site → Deploy manually），或连接 Git 仓库并将 Base directory 设置为 `model-chat-platform`。
2. Build command 留空，Publish directory 填 `public`；仓库中的 `netlify.toml` 会自动配置 Functions 和 `/api/*` 路由。
3. 部署完成后打开站点网址即可使用，无需注册或登录。
4. 每位用户在右侧填写自己的 OpenAI 兼容接口地址、API Key 和模型。配置会即时保存在当前浏览器的 localStorage 中，仅用于该浏览器发起请求，不写入平台服务端。

Netlify Function 会将请求转发到用户填写的模型网关。若网关需要额外的 CORS 或自定义请求头，请使用兼容 OpenAI Chat Completions 的地址。

平台默认允许模型输出 8192 token，并通过流式响应持续转发内容。Function 会每 4 秒发送合法的 SSE 保活注释，避免空闲连接被中间代理误判为结束；等待上游首次响应的默认上限为 25 秒，以便在 Netlify 同步请求达到平台硬超时前返回明确错误。若所用 Netlify 套餐的同步函数时限更短，可将 `UPSTREAM_TIMEOUT_MS` 设置为比该时限少 5 秒的值。
