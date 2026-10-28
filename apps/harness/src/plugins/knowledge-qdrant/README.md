# knowledge-qdrant

实现默认设备知识源，将向量检索、关键词检索和文档发布状态组合为统一来源。入口为 [knowledgeQdrantPlugin](index.ts)，实现为 [QdrantKnowledgeSource](qdrant-knowledge-source.ts)。

## 服务与依赖

- 提供 `ctx.qdrantKnowledge`，并向 `ctx.knowledge` 注册名称 `qdrant` 的来源；卸载时注销。
- 必需：`knowledge`、`vector`、`embedding`、`storage`、`cache`。
- 无独立插件参数；基础设施配置来自对应 Provider。

## 检索流程

查询向量化后，从 Vector 和 Storage 关键词检索各取最多 12 个候选，通过排名融合去重。随后以 Storage 中已发布的文档分片为准过滤结果，避免中断的向量写入提前出现在答案中。租户和 metadata 条件传递到两个检索后端。

尽管名称包含 Qdrant，本插件仅依赖 core 接口；mock 模式可搭配内存 Vector 和 Storage。它不直接使用 Qdrant SDK。

## 导入规则

`ingest(document, tenantId)` 获取租户/文档级 120 秒锁，按 Markdown 结构切块，限制每篇最多 200 个分片，批量向量化后先写 Vector，再由 Storage 发布文档和分片。锁在结束时按所有者 token 释放。

文档 ID 代表不可变版本：同一 ID 内容、标题或 metadata 发生变化时返回 `DOCUMENT_IMMUTABLE`，更新需使用新 ID。向量与 SQL 写入并非跨系统事务；发布过滤控制可见性，未提供自动清理孤立向量的任务。

默认由 [rag](../rag/README.md) 转发导入；管理员入口见 [knowledge-api](../knowledge-api/README.md)。
