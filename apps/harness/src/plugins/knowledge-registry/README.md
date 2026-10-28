# knowledge-registry

维护可插拔知识源目录，并按请求选择来源。入口为 [knowledgeRegistryPlugin](index.ts)，实现为 [KnowledgeRegistry](registry.ts)。

## 服务与配置

- 提供 `ctx.knowledge`（[KnowledgeRegistryService / KnowledgeSource](../../core/rag/knowledge-source.ts)）。
- 无服务依赖和插件参数；不直接访问模型、数据库或向量 SDK。

## 注册与检索

知识源实现 `name`、`description`、`search(request)`，可选 `default` 和 `ingest()`。在源插件中调用 `ctx.effect(() => ctx.knowledge.register(source))`，卸载时自动注销；重复名称会报错。

`get()` 查找来源，`list()` 返回决策可用的目录。`search()` 使用请求指定的 `sources`；未指定时选择 `default !== false` 的来源。来源名称去重后逐个搜索，返回各来源的排名列表，供 RAG 融合；未知来源返回 `UNKNOWN_KNOWLEDGE_SOURCE`。

注册表拒绝租户不匹配的返回文档，并再次执行请求 metadata 过滤。新来源仍须自行实施远端资源访问控制，提供稳定且不与其他来源冲突的分片 ID，并处理取消信号。来源目录和 metadata 过滤本身不授予部门或对象访问权限。

当前来源见 [knowledge-qdrant](../knowledge-qdrant/README.md) 与 [knowledge-cases](../knowledge-cases/README.md)；检索策略见 [rag](../rag/README.md)。
