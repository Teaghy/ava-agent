# model-compatibility

提供 `ctx.modelCompatibility`，以模型能力配置集中处理默认 OpenAI 兼容模型的消息和参数差异。该模块只执行确定的规则，不调用 LLM 判断，不重放 Agent 或业务工具。

`resolve({ baseURL, model }, options)` 按默认能力、已知部署规则、显式选项依次覆盖。匹配包含完整 Base URL（归一化末尾斜杠）和模型名称；不会按 Qwen 等模型家族整体套用消息重排。初始目录仅包含本项目实际遇到的 Intern Discovery `/v1` + `qwen3.8-27b` 消息模板限制。模型与地址保持原有大小写语义，URL 主机按标准 URL 解析归一化。

`register(rule)` 返回卸载函数，原生 Cordis 扩展可以通过 `ctx.effect` 注册额外规则。规则应针对已验证的具体部署；扩展规则优先于内置规则，ID 不可重复。默认服务由 bootstrap 装配，扩展只能注册规则，不能覆盖该底座服务。

`prepareModelMessages` 由 `chat`、`structuredOutput`、`stream` 共用。默认保留原消息结构，结构化输出在末尾追加 JSON Schema 指令；选中 `single-system-first` 后只合并原有系统指令与该 Schema 指令，保留用户和历史回答的角色及顺序，不修改调用者的原数组。

当前可配置能力：

- `messageFormat`：`auto` / `preserve` / `single-system-first`。
- `jsonOutput`：`auto` / `json-object` / `prompt`。prompt 省略 `response_format`，返回内容仍经 JSON 解析和 Zod 校验。
- `streamUsage`：`auto` / `enabled` / `disabled`。disabled 省略 `stream_options`，不会关闭正文流或结束状态校验。

未知部署使用原有默认参数；兼容性错误返回安全、可操作的错误码和维护提示。不会在业务请求失败后自动改变角色、放宽校验或反复试错。每次模型调用记录生效规则来源、规则 ID 和兼容选项，不记录消息和 Key。

Ops 应用配置时验证多轮结构化决策，以及启用 `ANSWER_STREAMING` 时的真实 SSE 正文与正常结束；失败保留原配置。详见 [模型配置](../../../../../docs/model-settings.md)。
