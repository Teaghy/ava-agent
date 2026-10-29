# response-policy

内置的可替换回答证据策略，提供 `ctx.responsePolicy`，契约复用 `AnswerPolicy`，无服务依赖。

原生 `Config.evidence` 支持 `knowledge-or-tool`（客服默认）、`knowledge`（知识问答）和 `optional`（自由聊天）。最终答案已有检索文档时必须提供引用；客服允许成功的非检索工具结果作为依据，知识问答只接受检索文档，自由聊天允许直接回答。追问不要求证据。

引用真实性和追加行业校验由基础 Guard 强制执行，不能由此策略关闭。Guard 将策略输入克隆为快照，任何修改都不会改写权威状态。

可通过 `providers.responsePolicy` 启动替换，或通过 Ops 的同名槽位管理独立 JS 插件。停用管理 Provider 时恢复应用或预设策略，失败使用现有 Cordis 装配回退。详见 [应用预设文档](../../../../../docs/application-presets.md)。
