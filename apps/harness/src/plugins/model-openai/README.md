# model-openai

使用 OpenAI SDK 适配兼容的 Chat Completions 服务。入口为 [modelOpenAIPlugin](index.ts)，实现为 [OpenAICompatibleModelService](openai-model.service.ts)。

## 服务与依赖

- 提供 `ctx.model`（[ModelService](../../core/model/model.service.ts)）。
- 必需：`telemetry`。
- `APP_MODE=live` 时装配，与 [model-mock](../model-mock/README.md) 二选一。

## 配置

| 插件参数  | 环境变量       | 默认值                      |
| --------- | -------------- | --------------------------- |
| `baseURL` | `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `apiKey`  | `LLM_API_KEY`  | 空；live 模式必须设置       |
| `model`   | `LLM_MODEL`    | `gpt-4.1-mini`              |

## 行为与限制

实现文本 `chat()`、内容 `stream()` 与 Zod 校验的 `structuredOutput()`。结构化输出追加 JSON Schema 提示并使用 `response_format: json_object`；接入其他兼容服务前需确认其支持这些请求字段。

三个入口共用 [model-compatibility](../model-compatibility/README.md) 的消息转换和能力配置。默认保留原消息结构；仅匹配具体部署规则或显式覆盖时合并 system 并置顶。可覆盖 JSON 参数与流式用量参数，结果 Schema、引用与 Guard 校验保持原要求。Ops 应用时验证多轮决策和流式正文，错误提示指出对应兼容设置；不会在线自动重写并重试格式错误的请求。

结构化调用的错误会进入 Ops 运行轨迹：`MODEL_RATE_LIMITED`（429）、`MODEL_TIMEOUT`、`MODEL_AUTH_FAILED`、`MODEL_UNAVAILABLE`；输出校验区分 `MODEL_OUTPUT_TRUNCATED`（达到输出上限）、`INVALID_MODEL_JSON` 和 `INVALID_MODEL_OUTPUT`（字段不符合 schema）。诊断日志仅记录运行标识、模型、错误码、完成状态和内容长度，不记录原始响应、提示词、密钥或推理。不会自动放宽 schema 或绕过 Guard。

SDK 请求超时 30 秒、最多重试一次，并透传取消信号。日志记录 token 用量和运行标识。`stream()` 仅转发 delta.content，不输出 reasoning 或 tool_calls。它要求正常 stop 结束，输出截断和缺少结束标记都返回明确错误，不将半截文本当作完整成功答案。普通问答通过独立 AnswerService 使用此流；业务工具和额外审核策略下仍缓冲校验后发送。

提示词、上下文预算及下一步判断属于 [decision-main-model](../decision-main-model/README.md)。插件本身不执行工具、不授予权限。参见 [插件索引](../README.md)。
