# memory

基于现有 Storage 提供长期记忆接口。入口与实现为 [memoryPlugin](index.ts)，Cordis 插件名为 `memory-storage`。

## 服务与配置

- 提供 `ctx.memory`（[MemoryService](../../core/memory/memory.service.ts)）。
- 必需：`storage`；无独立插件参数。
- `MEM0_ENABLED=false`（默认）时装配，与 [memory-mem0](../memory-mem0/README.md) 二选一。

## 行为与限制

`remember()` 生成 ID 和时间并保存内容及分类；`recall()` 按租户与用户读取记忆，根据查询按空白分词后的命中数量排序，默认返回 5 条；`forget()` 按所有者范围删除。

当前检索为简单文本匹配，没有向量语义搜索或 Mem0 的记忆抽取能力。使用内存 Storage 时重启丢失；使用 PostgreSQL 时持久化到记忆表。

Agent 会尝试读取该接口中的记忆，但目前没有把整段聊天自动写入长期记忆的流程；需要业务明确调用 `remember()`，不能仅因开启 Provider 就认为聊天已被长期保存。

会话近期消息和滚动摘要属于 [sessions](../sessions/README.md)。参见 [插件索引](../README.md)。
