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

实现文本 `chat()`、内容 `stream()` 与 Zod 校验的 `structuredOutput()`。结构化输出追加 JSON Schema 提示并使用 `response_format: json_object`；无效结果以 `INVALID_MODEL_OUTPUT` 错误返回。接入其他兼容服务前需确认其支持这些请求字段。

SDK 请求超时 30 秒、最多重试一次，并透传取消信号。日志记录 token 用量和运行标识。`stream()` 仅输出内容，不暴露推理字段；聊天 API 当前由 Agent 在答案完成校验后分段发送，并未直接使用该模型流。

提示词、上下文预算及下一步判断属于 [decision-main-model](../decision-main-model/README.md)。插件本身不执行工具、不授予权限。参见 [插件索引](../README.md)。
