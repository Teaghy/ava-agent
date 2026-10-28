# tools

维护工具目录，统一执行参数校验、权限检查、追踪与审计。本目录包含三个独立 Cordis 插件，均从 [index.ts](index.ts) 导出。

## 插件与依赖

| 导出                      | 插件名                | 依赖                   | 能力                           |
| ------------------------- | --------------------- | ---------------------- | ------------------------------ |
| `toolsPlugin`             | `tools`               | `storage`、`telemetry` | 提供 `ctx.tools`               |
| `knowledgeToolPlugin`     | `knowledge-tools`     | `tools`、`rag`         | 注册两个知识检索工具           |
| `mockBusinessToolsPlugin` | `mock-business-tools` | `tools`、`guard`       | 注册五个模拟业务工具及工单校验 |

三个插件均无配置参数。内置工具通过 `ctx.effect` 注册，卸载时注销。

## 注册与执行

[ToolRegistry](registry.ts) 实现 [ToolService / AgentTool](../../core/tools/tool.ts)。新增工具需定义唯一名称、描述、`permission`、Zod `inputSchema` 和 `execute()`。工具目录中的 JSON Schema 由输入 schema 生成。

检索工具增加 `kind: 'retrieval'`，其调用计入 Runtime 的检索预算，轨迹保留分类。自定义检索工具需同样声明；空检索结果不能作为业务操作成功的依据。

执行时校验取消信号、服务端 Principal 权限和输入结构，记录 `tool.execute` span；输出 JSON 不得超过 64000 字节。已找到的工具无论成功、失败或拒绝，均记录审计状态。模型只能选择工具，无法授予权限；真实业务 Provider 还需校验设备、工单等对象归属。

审计无法写入时记录不含原始异常或工具结果的 `tool.audit_failed` 日志，并抛出公开的 `ToolAuditError`（`@ava/harness/plugin`）。其 `audit` 保留实际状态，成功执行时 `result` 保留返回值；对客户端只返回安全的 `TOOL_AUDIT_FAILED` 提示。Runtime 将其视为需要核对的运行故障，保留已知结果并中止本轮，不作为普通工具失败交给模型重试。该行为不保证跨请求幂等；真实业务写入仍需业务系统支持幂等键。

## 内置工具

| 工具               | 权限  | 输入与用途                                      |
| ------------------ | ----- | ----------------------------------------------- |
| `knowledge_search` | READ  | `query`，可选 `sources`、`filters`，检索知识    |
| `case_search`      | READ  | 同上，但固定使用 `cases` 来源与 `category=case` |
| `device_query`     | READ  | `id`，模拟设备信息                              |
| `device_status`    | READ  | `id`，模拟 E102 状态                            |
| `ticket_query`     | READ  | `id`，模拟查询                                  |
| `create_ticket`    | WRITE | `description`，返回模拟工单 ID                  |
| `human_handoff`    | WRITE | `description`，返回模拟转人工状态               |

[知识工具](built-in/knowledge-search.tool.ts) 从 Principal 获取租户，发送 `rag.started/completed`，并把文档按 ID 合并进运行上下文，保留最近 15 条。查询长度为 1–2000 字符，最多指定 10 个来源。

[业务工具](built-in/business-tools.ts) 只在 mock 模式默认装配，可用 `demoTools: false` 关闭；live 模式不会装配这些工具。它们返回 `mock: true`，不连接真实设备、工单或人工客服。真实业务通过 `options.plugins` 注册，并为写入设计幂等策略。匿名演示身份只有 READ 权限。

参见 [插件索引](../README.md)。
