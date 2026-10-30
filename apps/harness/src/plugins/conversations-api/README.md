# conversations-api

提供当前用户的会话列表与历史消息。入口与实现为 [conversationsApiPlugin](index.ts)。

支持 `POST /api/v1/conversations/delete`，请求 `{ "conversationId": "conv001" }`，成功返回 `{ "deleted": true }`。只允许当前租户、当前用户删除自己的会话，业务管理员不绕过归属检查；未认证返回 401，越权返回 403，不存在或已删除返回 404，仍在运行的会话返回 409，应先停止生成。

删除与 Agent 使用相同的会话锁。存储层清除消息和摘要、保留已删除标记，列表不再返回该会话，历史和旧 ID 的后续聊天被拒绝。PostgreSQL 在同一事务中完成，并与摘要写入锁定同一会话行，防止后台摘要重新创建已删除内容。

Ops 运行轨迹、不可变事件、工具审计和独立长期记忆不随个人聊天删除，继续按维护侧的数据保留策略管理；此接口不是所有个人数据的彻底擦除接口。自定义 Storage Provider 需实现 `deleteConversation(id, principal)` 并保留相同的身份隔离与删除约束。PostgreSQL 部署前执行新增的 `0004_conversation_deletion` 迁移。

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
