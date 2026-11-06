# session-summarizer

提供可替换的 `ctx.summarizer`（SummarizerService），依赖 `contextBuilder`、`modelRouter`。默认使用原有提取式滚动摘要；显式设置 `SESSION_SUMMARY_MODE=model` 时通过 summary 角色调用模型。最近八条历史留给后续直接携带，模型只总结较早历史及原摘要。

接口只返回最多 6000 字符的背景文本。sessions 负责触发阈值、隔离输入、检查取消以及持久保存，保留既有权威事实和动作字段。失败保留旧摘要，后台失败不撤销已完成的回答，不写入个人长期记忆。配置见 [模型分工](../../../../../docs/model-routing.md)。
