# answer-model

提供 `ctx.answer`（AnswerService），只负责最终用户正文的生成。决策阶段选择工具或 `answer_ready`，不在该决策 JSON 中生成整篇回答。AnswerService 使用服务端回答提示词和 ContextBuilder 组装上下文，并通过当前 ModelService 的 `stream()` 生成正文，不暴露模型推理或调用工具。

运行层只传入本次已核实引用对应的文档、成功的业务工具结果，以及有预算限制的历史、摘要和记忆。引用标题和原文地址由服务端绑定；提示词要求不将摘要或记忆当作已确认的业务事实。模型动态切换时使用当前已安装的 ModelService，不重新存储模型凭据。

输出是否实时对用户可见，由运行层和 Guard 决定。默认仅没有非检索业务工具、没有附加行业审核、且回答策略明确允许流式时实时发送。自定义回答策略默认缓冲，只有与最终措辞无关的证据校验才能声明 `allowStreaming:true`。已经发出的文字无法撤回；需要审查整篇措辞的策略不要开启此标志。

`ANSWER_STREAMING=true` 默认开启 live 决策与回答拆分；false 恢复 legacy final_answer 路径。实时输出仍受总运行超时、取消信号和 16000 字符上限约束，失败或中止不会保存为成功回答。Ops 的“生成回答”节点记录 delivery、firstTokenMs、outputChars 和耗时；firstTokenMs 是该生成步骤的模型首字时间，不是整次请求的总等待时间。
