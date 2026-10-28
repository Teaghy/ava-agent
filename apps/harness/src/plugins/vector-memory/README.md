# vector-memory

提供开发和测试使用的进程内向量存储。入口与实现为 [vectorMemoryPlugin / InMemoryVector](index.ts)。

## 服务与配置

- 提供 `ctx.vector`（[VectorService](../../core/vector/vector.service.ts)）。
- 无服务依赖、外部连接或插件参数。
- 默认 mock 模式装配；外部基础设施模式改用 [vector-qdrant](../vector-qdrant/README.md)。

## 行为与限制

支持按 ID upsert、删除及检索。检索先过滤 `tenantId` 和 metadata，再计算向量点积排序并取指定条数；归一化向量下点积对应余弦相似度。数据读写使用结构化克隆。

此实现不生成向量，也不负责文档切块、关键词检索或融合；这些属于 Embedding 和知识源。数据在进程重启后丢失，不提供外部向量数据库的索引和持久化能力。

参见 [插件索引](../README.md)。
