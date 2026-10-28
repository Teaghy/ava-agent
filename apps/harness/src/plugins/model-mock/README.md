# model-mock

不访问外部模型的确定性演示 Provider。入口为 [modelMockPlugin](index.ts)，实现为 [MockModel](mock-model.service.ts)。

## 服务与配置

- 提供 `ctx.model`（[ModelService](../../core/model/model.service.ts)），无服务依赖和插件参数。
- `APP_MODE=mock` 时装配，与 [model-openai](../model-openai/README.md) 二选一。
- 不需要模型 API Key；基础设施是否使用外部服务由 `INFRA_MODE` 独立决定。

## 演示行为

结构化决策在没有检索结果与工具观察时选择 `knowledge_search`；已有检索文档时生成带引用的演示答案；存在观察但无文档时追问。`chat()` 返回演示文本，`stream()` 以单段输出。

用于本地跑通聊天、RAG、事件和权限流程，以及可重复的 Vitest 测试。它不能替代真实模型的理解、决策或回答质量验证，也不会因为接入外部数据库而变成真实模型。

参见 [插件索引](../README.md) 与 [项目启动说明](../../../../../README.md)。
