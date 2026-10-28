# guard

在答案或追问发给用户前执行行业校验，并对最终答案校验引用和基本依据。入口与实现为 [guardPlugin](index.ts)，Cordis 插件名为 `answer-guard`。

## 服务与配置

- 提供 `ctx.guard`（[GuardService](../../core/guard/guard.service.ts)）。
- 无服务依赖和插件参数；Agent 将它声明为强依赖，缺失时不会激活默认 Runtime。

## 当前校验

- 每条引用的文档 ID、分片 ID、标题和来源必须与本次运行检索文档一致，否则返回 `INVALID_CITATION`。
- 运行已有检索文档时，最终答案必须包含引用，否则返回 `CITATION_REQUIRED`。
- 最终答案没有文档，也没有成功的非检索工具观察结果时，返回 `LOW_CONFIDENCE`。
- `ask_user` 不要求知识证据或引用，但仍需经过全部行业策略，不能通过追问分支绕过动作一致性、隐私或承诺校验。
- 模拟工单的动作一致性规则由 `mock-business-tools` 追加；真实业务插件按自己的工具和结果注册策略。

`ctx.guard.register({ name, validate })` 返回注销函数，使用 `ctx.effect` 持有。策略名不能重复，基础校验之后按注册顺序等待同步或异步策略；任一策略抛错都会阻止响应保存与输出。策略参数为独立快照，第 4 个参数为可选 `AbortSignal`，第 5 个参数为 `responseType`（`final_answer` 或 `ask_user`），可用于区分行业规则，不能通过修改参数改写运行状态。`GuardService.validate` 返回 Promise，调用方必须 await；省略第 5 个参数时沿用最终答案校验，已有调用兼容。

校验失败会阻止最终答案分段输出。这些是确定性规则，不能证明每个回答句子都受引用支持，也不能证明模拟工具已经产生真实业务结果。工具执行权限由工具注册表校验。

参见 [agent-loop](../agent-loop/README.md) 与 [tools](../tools/README.md)。
