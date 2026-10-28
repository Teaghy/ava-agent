# decision-main-model

把主模型封装为统一的决策服务，使 Agent 循环通过接口选择下一步。入口为 [mainModelDecisionPlugin](index.ts)，实现为 [MainModelDecisionService](main-model-decision.service.ts)。

## 服务与依赖

- 提供 `ctx.decision`（[DecisionService](../../core/decision/decision.service.ts)）。
- 必需：`model`、`telemetry`。
- 当前唯一的决策 Provider；尚无规则、独立 Router 或 Hybrid Provider。

## 配置

| 插件参数        | 来源                                                | 默认值   |
| --------------- | --------------------------------------------------- | -------- |
| `systemPrompt`  | bootstrap 读取 [system.md](../../prompts/system.md) | 文件内容 |
| `contextTokens` | `CONTEXT_TOKEN_BUDGET`                              | 12000    |

## 决策契约

`decide(input, context)` 接收任务目标、意图、实体、工具与知识源目录，以及近期消息、摘要、观察结果、检索文档、记忆和取消信号。ContextBuilder 在预算内组装上下文，并为结构化输出 schema 预留空间；预算采用保守估算，并非模型专用 tokenizer 的精确计数。

每次决策调用一次 `model.structuredOutput()`，结果经 [decisionSchema](../../core/decision/decision.schema.ts) 校验：

- `tool_call`：工具名称与参数；RAG 通过 `knowledge_search` / `case_search` 工具执行。
- `final_answer`：答案和可选引用。
- `ask_user`：向用户追问。

取消信号向模型透传，调用前后均检查；记录 `model.decision` span 和模型延迟。替换决策策略时实现同一接口并替换 bootstrap 注册，保留运行层的权限、限额与 Guard。参见 [插件索引](../README.md)。
