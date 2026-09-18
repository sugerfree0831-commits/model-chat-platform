# Chat Hub

面向团队的 OpenAI 兼容模型对话工作台，支持本地 Node 和 Netlify 部署。

## Netlify 部署

将 `model-chat-platform` 作为站点根目录导入，Netlify 会读取 `netlify.toml`。

环境变量：

- `TEAM_USERS`：JSON 数组，例如 `[{"username":"demo","password":"请修改","name":"管理员"}]`
- `TEAM_MODELS`：可选，统一管理模型列表（当前函数内置四个模型）

API Key 由用户在浏览器本地填写，通过 Functions 转发，不写入平台存储。正式上线建议接企业 SSO、数据库会话和加密密钥托管。
