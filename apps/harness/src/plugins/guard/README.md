# guard

在最终答案发给用户前校验引用和基本依据。入口与实现为 [guardPlugin](index.ts)，Cordis 插件名为 `answer-guard`。

## 服务与配置

- 提供 `ctx.guard`（[GuardService](../../core/guard/guard.service.ts)）。
- 无服务依赖和插件参数；Agent 将它声明为可选，默认 bootstrap 会装配。

## 当前校验

- 每条引用的文档 ID、分片 ID、标题和来源必须与本次运行检索文档一致，否则返回 `INVALID_CITATION`。
- 运行已有检索文档时，最终答案必须包含引用，否则返回 `CITATION_REQUIRED`。
- 没有文档，也没有成功的非检索工具观察结果时，返回 `LOW_CONFIDENCE`。
- 答案匹配“工单已创建/创建成功”类表述时，必须存在已完成的 `create_ticket` 调用，否则返回 `TOOL_INCONSISTENT`。

校验失败会阻止最终答案分段输出。这些是确定性规则，不能证明每个回答句子都受引用支持，也不能证明模拟工具已经产生真实业务结果。工具执行权限由工具注册表校验。

参见 [agent-loop](../agent-loop/README.md) 与 [tools](../tools/README.md)。
