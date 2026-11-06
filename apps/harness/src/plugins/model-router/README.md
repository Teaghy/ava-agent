# model-router

提供可替换的 `ctx.modelRouter`，通过 `get('decision' | 'answer' | 'summary')` 在调用时选择模型。live 下角色连接读取对应的 `DECISION_LLM_*`、`ANSWER_LLM_*`、`SUMMARY_LLM_*`；未分配的角色按需读取当前 `ctx.model`。mock 只使用默认模型。依赖 `modelCompatibility`、`telemetry`；无需模型的规则决策部署仍可启动。

独立连接不继承默认模型凭据，失败不隐式转发到其他模型。替换 modelRouter Provider 可接入其他模型协议或路由策略。配置、兼容设置和生命周期见 [模型分工](../../../../../docs/model-routing.md)。
