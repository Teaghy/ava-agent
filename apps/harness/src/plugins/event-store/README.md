# event-store

追加 Agent 运行事件并提供回放与检查点读取。入口与实现为 [eventStorePlugin](index.ts)。

## 服务与依赖

- 提供 `ctx.eventStore`（[EventStoreService](../../core/event/event-store.service.ts)）。
- 必需：`storage`；无独立插件参数。

## 契约与生命周期

`append(state, tenantId, type, payload)` 生成事件 ID 和时间，克隆 payload，保存租户、runId、conversationId。成功写入 Storage 后才触发 Cordis 的 `harness/event`，供可观测性订阅。

`replay(runId, tenantId)` 返回该租户下的运行事件；`recover()` 找到最后一个 checkpoint，并用 AgentState schema 校验后返回。事件类型定义见 [agent-event.ts](../../core/event/agent-event.ts)。

事件存储的持久性由 Provider 决定：内存模式重启丢失；PostgreSQL 模式使用追加事件表，配套迁移限制更新与删除。`recover()` 只返回状态，不调度恢复执行，也不保证跨系统 exactly-once 或业务写入重试安全。

管理员回放接口见 [knowledge-api](../knowledge-api/README.md)，检查点写入见 [sessions](../sessions/README.md)。
