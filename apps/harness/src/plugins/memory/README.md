# memory

基于现有 Storage 提供长期记忆接口。入口与实现为 [memoryPlugin](index.ts)，Cordis 插件名为 `memory-storage`。

## 服务与配置

- 提供 `ctx.memory`（[MemoryService](../../core/memory/memory.service.ts)）。
- 必需：`storage`；无独立插件参数。
- `MEM0_ENABLED=false`（默认）时装配，与 [memory-mem0](../memory-mem0/README.md) 二选一。

## 行为与限制

`remember()` 生成 ID 和时间并保存内容及分类。`recall()` 按租户和用户读取记忆，对查询分词后按文本命中数量排序，跳过零命中记录，默认返回 5 条。`forget()` 按所有者范围删除。

当前检索为简单文本匹配，没有向量语义搜索或 Mem0 的记忆抽取能力。使用内存 Storage 时重启丢失；使用 PostgreSQL 时持久化到记忆表。

`MEMORY_TOOLS_ENABLED=true` 时装配 [memory-tools](tools.ts)，通过 `ctx.memory` 提供按需检索、显式写入和遗忘。工具只向个人身份开放，保存和删除的目标从当前用户消息读取。业务插件也可直接调用 `remember()`。启用 Provider 和启用聊天工具是两个独立配置。

会话近期消息和滚动摘要属于 [sessions](../sessions/README.md)。参见 [插件索引](../README.md)。
