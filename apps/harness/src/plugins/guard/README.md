# guard

在最终答案发给用户前校验引用和基本依据。入口与实现为 [guardPlugin](index.ts)，Cordis 插件名为 `answer-guard`。

## 服务与配置

- 提供 `ctx.guard`（[GuardService](../../core/guard/guard.service.ts)）。
- 无服务依赖和插件参数；Agent 将它声明为强依赖，缺失时不会激活默认 Runtime。

## 当前校验

- 每条引用的文档 ID、分片 ID、标题和来源必须与本次运行检索文档一致，否则返回 `INVALID_CITATION`。
- 运行已有检索文档时，最终答案必须包含引用，否则返回 `CITATION_REQUIRED`。
- 没有文档，也没有成功的非检索工具观察结果时，返回 `LOW_CONFIDENCE`。
- 模拟工单的动作一致性规则由 `mock-business-tools` 追加；真实业务插件按自己的工具和结果注册策略。

`ctx.guard.register({ name, validate })` 返回注销函数，使用 `ctx.effect` 持有。策略名不能重复，基础校验之后按注册顺序等待同步或异步策略；任一策略抛错都会阻止答案保存与输出。策略参数为独立快照，提供可选 `AbortSignal`，不能通过修改参数改写运行状态。`GuardService.validate` 现在返回 Promise，调用方必须 await。

校验失败会阻止最终答案分段输出。这些是确定性规则，不能证明每个回答句子都受引用支持，也不能证明模拟工具已经产生真实业务结果。工具执行权限由工具注册表校验。

参见 [agent-loop](../agent-loop/README.md) 与 [tools](../tools/README.md)。
