# observability

提供统一日志与 tracing 接口。入口与实现为 [observabilityPlugin](index.ts)。

## 服务与配置

- 提供 `ctx.telemetry`（[TelemetryService](../../core/observability/telemetry.service.ts)），无服务依赖。

| 插件参数   | 来源                               | 默认值                  |
| ---------- | ---------------------------------- | ----------------------- |
| `enabled`  | `OTEL_ENABLED`                     | false                   |
| `endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT`      | `http://localhost:4318` |
| `quiet`    | `createHarness(config, { quiet })` | 未设置                  |

## 日志与追踪

Pino 默认输出 info 日志，`quiet` 时静默；配置对 `apiKey`、`authorization` 和一层嵌套 `apiKey` 字段脱敏。`log()` 附带当前 trace ID；调用方仍须避免传入未覆盖的敏感字段。

`span()` 包裹异步操作，记录异常并结束 span。模型决策、工具与 RAG 等服务通过该接口创建追踪。插件订阅 `harness/event`，只记录事件类型和运行/会话标识，不记录完整事件 payload。

启用 OTEL 时创建 NodeSDK，服务名为 `ava-agent-harness`，通过 HTTP 向配置 endpoint 后的 `/v1/traces` 导出；endpoint 应填写 collector 基地址。卸载时关闭 SDK。

未开启 OTEL 时仍可输出日志，但没有配置 trace 导出；当前未内置 Collector、可视化后台、完整指标系统或自动 HTTP instrumentation。参见 [插件索引](../README.md)。
