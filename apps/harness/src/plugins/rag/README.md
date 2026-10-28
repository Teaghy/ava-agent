# rag

编排检索策略，向工具层提供统一的搜索和导入接口。入口为 [ragPlugin](index.ts)，实现为 [createRetrievalService](retrieval.service.ts)。

## 服务与依赖

- 提供 `ctx.rag`（[RagService](../../core/rag/rag.service.ts)）。
- 必需：`knowledge`、`telemetry`；可选：`reranker`。
- 无独立插件参数，不直接依赖 Vector、模型或数据库 SDK。

## 检索流程

1. [查询改写](query-rewriter.ts) 保留原查询，结合实体 hints，并为 `E102` 一类错误码生成 troubleshooting 查询，去重后最多 3 条。
2. 通过知识源注册表执行各查询，保留租户、来源、metadata 和取消信号。
3. 使用 reciprocal rank fusion 合并候选，取前 12 条。
4. 若存在重排器则调用，再由 [上下文选择](context-selector.ts) 取前 5 条，记录 `rag.search` span。

当前查询改写是规则实现，没有额外模型调用；默认重排器为透传。知识源负责具体数据访问，RAG 不假定所有来源都来自 Qdrant。

## 导入与扩展

`ingest()` 当前固定委托 `qdrant` 来源；来源不存在或不支持导入时返回 `INGESTION_UNAVAILABLE`。新增只读来源只需实现并注册 KnowledgeSource；更改默认导入目标需调整本实现。

参见 [knowledge-registry](../knowledge-registry/README.md)、[knowledge-qdrant](../knowledge-qdrant/README.md) 和 [reranker](../reranker/README.md)。
