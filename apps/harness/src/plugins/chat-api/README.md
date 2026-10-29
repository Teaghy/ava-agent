# chat-api

向客户端开放聊天 SSE 接口。入口与实现为 [chatApiPlugin](index.ts)。

## 依赖与配置

- 必需：`http`、`agent`、`sessions`、`cache`；不提供新的 Cordis 服务。
- 参数为 [AuthConfig](../../core/http/auth.ts)：`keys` 来自 `API_KEYS`；所有模式都要求独立 Token。
- Bearer Token 在服务端映射到 Principal。没有共享匿名身份，缺失或无效 Token 返回 401。

## 接口

`POST /api/v1/chat`，JSON 请求示例：

```json
{
  "conversationId": "conv001",
  "message": "我的 VCD-2000 报 E102，怎么处理？"
}
```

`conversationId` 为 1–100 个字母、数字、下划线或连字符；message 去除首尾空白后为 1–2000 字符。共享 [请求 schema](../../../../../packages/protocol/src/chat/request.ts) 拒绝额外字段，不能通过 body 提交用户、租户或权限。

按租户/用户固定窗口限流，每 60 秒最多 30 次，超限返回 429。打开 SSE 前验证会话所有权，之后把客户端取消信号传给 Agent。路由通过 `ctx.effect` 注册，卸载时注销。

## 返回与客户端

SSE 包含 `agent.started/step`、`tool.started/completed`、`rag.started/completed`、`answer.delta/completed` 和 `error`，data 结构见 [事件协议](../../../../../packages/protocol/src/chat/events.ts)。开始流之前的错误返回普通 JSON；流开始后的错误发送 SSE error 事件。

答案完成 Guard 校验后才分段发送 delta，不是模型 token 直传。POST 流可用仓库 SDK 或 fetch 读取；浏览器原生 EventSource 不支持此 JSON POST 方式。参见 [项目调用示例](../../../../../README.md)。
