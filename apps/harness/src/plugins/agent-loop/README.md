# agent-loop

执行客服 Agent 的逐步决策与工具调用循环。入口为 [agentLoopPlugin](index.ts)，实现位于 [react-loop.ts](react-loop.ts)。

## 服务与依赖

- 提供 `ctx.agent`（[AgentService](../../core/agent/agent.service.ts)）。
- 必需：`decision`、`knowledge`、`tools`、`sessions`、`eventStore`、`cache`、`telemetry`、`guard`。
- 可选：`memory`；默认装配中启用。

## 配置

参数由 [bootstrap](../../bootstrap/plugins.ts) 注入：

| 插件参数         | 环境变量           | 默认值 |
| ---------------- | ------------------ | ------ |
| `maxSteps`       | `MAX_AGENT_STEPS`  | 8      |
| `maxToolCalls`   | `MAX_TOOL_CALLS`   | 10     |
| `maxRagSearches` | `MAX_RAG_SEARCHES` | 3      |
| `runTimeoutMs`   | `RUN_TIMEOUT_MS`   | 90000  |

## 执行行为

`run(input, emit)` 校验会话归属、获取会话锁，加载近期消息、摘要及可用长期记忆；每一步调用 `decision.decide()`，执行工具或结束回答，并追加轨迹及检查点。工具目录按当前用户权限过滤，实际执行仍由工具注册表校验。

同一会话使用 120 秒租约锁；执行超时上限为 90 秒。达到步骤、工具或检索限额会停止运行。客户端断开会传播取消信号，结束时释放属于当前运行的锁。可选记忆读取失败会记录日志，不阻断正常回答。

`final_answer` 和 `ask_user` 保留完整校验后发送的兼容路径。live 默认决策为简短的 `answer_ready`，运行层通过独立 AnswerService 生成最终正文：普通问答通过引用与依据预检后，随模型生成实时发送 `answer.delta`。执行过非检索业务工具、有附加行业审核、或策略未声明 `allowStreaming:true` 时，完整生成并通过 Guard 后才发送。流式完成后仍执行最终 Guard；已经发送的文字不能事后撤回。只有成功完成并校验的全文才保存为 assistant 消息；中断、输出截断或取消时不发送 `answer.completed`，Ops 错误记录标记 partialAnswer 和已输出字符数。完成响应后在后台按会话顺序更新摘要，不阻塞回答或持有会话锁；失败仅记录 `summary.failed`，不把已完成回答改为失败。停止时取消并等待摘要任务后再释放基础设施。

审计写入失败返回 `TOOL_AUDIT_FAILED`，停止当前轮而不继续模型决策或重试工具。若工具已经成功，检查点保留其 `completed` 调用与结果，错误提示要求人工核对；并发取消不会覆盖此故障。检查点与回放用于诊断，不会自动恢复执行或重试业务写入。持久存储同时故障时无法保证检查点已写入，真实写入仍需业务幂等键与结果核对。

模型决策配置属于 [decision-main-model](../decision-main-model/README.md)，最终正文由 [answer-model](../answer-model/README.md) 生成；Agent 循环不直接依赖模型 SDK 或提示词构建。参见 [插件索引](../README.md)。

Runtime 接收 `AgentDependencies`，由插件入口从 Cordis 注入。Decision 的输入为快照，修改它不能改写工具授权或运行证据。检索限额根据工具 `kind: 'retrieval'` 判定，支持自定义名称。`stop()` 取消并等待正在执行的任务，随后旧服务对象拒绝新运行；插件卸载时会调用该方法。所有外部调用应响应取消信号。
