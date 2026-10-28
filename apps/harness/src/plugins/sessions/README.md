# sessions

管理会话消息、滚动摘要与运行检查点。入口与实现为 [sessionsPlugin](index.ts)。

## 服务与依赖

- 提供 `ctx.sessions`（[SessionService](../../core/session/session.service.ts)）。
- 必需：`storage`、`cache`、`eventStore`；无独立插件参数。

## 行为

`open()` 通过 Storage 创建或校验会话归属，写入 3600 秒会话缓存。`recent()` 获取最近 20 条消息；`add()` 生成消息 ID 和时间，保留可选引用及 runId，消息内容持久性取决于 Storage Provider。

`checkpoint()` 保存运行状态、追加 checkpoint 事件，并写入 3600 秒运行缓存。Storage、事件和缓存写入按顺序执行，并非跨系统原子事务。

`summarize()` 检查最近 21 条消息：达到 20 条或内容总量达到 24000 字节时，生成最长 6000 字符的抽取式滚动摘要，保留最近 8 条之外的部分历史。它不调用模型，也不会自行把用户陈述推断成已确认事实或已执行动作。

会话所有权在入口 `open()` 或 Storage 的显式断言中检查；内部按会话 ID 读写方法应在完成身份校验后调用。此插件不负责长期记忆或自动恢复运行。

参见 [event-store](../event-store/README.md)、[memory](../memory/README.md) 与 [插件索引](../README.md)。
