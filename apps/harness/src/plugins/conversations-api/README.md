# conversations-api

提供当前用户的会话列表与历史消息。入口与实现为 [conversationsApiPlugin](index.ts)。

## 依赖与配置

- 必需：`http`、`storage`；不提供新的 Cordis 服务。
- 参数为 [AuthConfig](../../core/http/auth.ts)，由 bootstrap 统一传入 Token 映射；鉴权规则与聊天接口相同。
- 两个路由通过 `ctx.effect` 注册，卸载时注销。

## 接口

| 方法 | 路径                            | 请求                              | 返回                                            |
| ---- | ------------------------------- | --------------------------------- | ----------------------------------------------- |
| GET  | `/api/v1/conversations`         | 无 body                           | `{ conversations }`，最多 100 个当前用户会话    |
| POST | `/api/v1/conversations/history` | `{ "conversationId": "conv001" }` | `{ messages, limit: 100 }`，最近最多 100 条消息 |

历史输入使用共享 schema，仅接受合法 conversationId。查询前验证会话存在及租户/用户归属：不存在返回 404，无权访问返回 403。消息保留引用和 runId，供 Web 恢复答案来源。

接口不提供分页游标、会话删除或历史查询时自动创建会话；存储是否跨重启保留取决于 Storage Provider。新会话在聊天入口打开时创建。

参见 [chat-api](../chat-api/README.md)、[sessions](../sessions/README.md) 与 [插件索引](../README.md)。
