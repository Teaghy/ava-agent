# context-builder

提供可替换的 `ctx.contextBuilder`（ContextService）。默认复用 ContextBuilder 的预算和裁剪算法，按既有优先级保留系统规则、当前问题、工具、观察和知识，再选择历史、摘要及记忆。`purpose` 区分决策、回答和摘要，允许插件选择不同的输入组织方式。

消费者通过公开的 `buildModelContext` 传入隔离快照，保留原始取消信号，并验证返回消息格式和预算。自定义插件应保留必需规则和数据来源语义，不能将历史摘要当作已核实的业务证据。接口及示例见 [模型分工](../../../../../docs/model-routing.md)。
