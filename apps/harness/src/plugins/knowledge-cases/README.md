# knowledge-cases

为历史客服案例提供独立的来源名称。入口为 [knowledgeCasesPlugin](index.ts)，实现为 [CaseKnowledgeSource](case-knowledge-source.ts)。

## 服务与依赖

- 必需：`knowledge`、`qdrantKnowledge`。
- 不提供新的 Cordis 服务；注册 `cases` 知识源，卸载时注销。
- 无独立插件参数，`default=false`，普通默认检索不会自动选择它。

## 使用与限制

`search()` 委托默认设备知识源，并强制附加 `metadata.category=case`。Agent 可调用 `case_search` 工具，或在检索请求中显式指定 `sources: ['cases']`。

案例目前与设备知识存储在同一 Vector / Storage 后端；通过默认知识导入接口写入，metadata 设为 `category: 'case'`。此来源没有独立导入方法，也尚未接入外部工单系统。

其租户隔离、发布过滤及向量/关键词融合行为继承 [knowledge-qdrant](../knowledge-qdrant/README.md)。参见 [tools](../tools/README.md)。
