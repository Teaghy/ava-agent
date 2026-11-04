Use case: infographic-diagram.
Asset type: a readable Chinese software architecture diagram for a repository, NOT a concept mockup.
Create ONE high-resolution landscape architecture infographic, preferably 3200x2400, white background, crisp flat vector-like lines, modern technical documentation style, dark navy Chinese sans-serif typography, restrained blue / teal / violet accents. Large readable labels, ample spacing, organized grid, orthogonal connectors with clear arrowheads. No perspective, 3D, photographs, decorative objects, watermarks or invented modules. Draw only the architecture specified below, which has been checked against source code. All text in quotes must be accurate Chinese, no garbled glyphs. The diagram needs to be useful to an engineer and a company founder. Use short labels and maintain hierarchy, rather than tiny dense paragraphs.

TITLE at top: "Ava Agent 当前架构"
Subtitle: "代码现状 · 2026-10-31 · 单进程插件底座"

TOP: four access cards in one row with distinct audiences.

1. "客服端 Web" / "终端用户 / 客服人员" / "对话 · 历史 · 引用 · 流式输出"
2. "业务后台 Admin" / "租户管理员" / "成员 · 角色 · 应用 · Key 管理"
3. "外部系统 / 设备" / "自主管理用户" / "应用 Key + conversationId"
4. "维护端 Ops" / "平台维护人员" / "模型配置 · 插件 · 执行轨迹"
   Under the first two cards, a small shared strip says "@ava/ui · React / Radix". A second shared integration strip under the business cards says "@ava/sdk → @ava/protocol". Ops uses SDK too; don't imply the device must use SDK.

CENTER: one large enclosing rounded rectangle labeled "Harness 服务端 · 同一 Node.js 进程". Emphasize that this is NOT separate microservices. Inside this process are two entry lanes:
Left, main lane: "业务 HTTP / SSE" with small label "默认 :3000" and "账号 Cookie / 个人 Token / 应用 Key". Arrows from Web, Admin, and external systems enter this lane. Below it: "身份与权限 Principal" and "租户 · 用户 / 应用 · 知识空间 · 工具权限". Under this: "业务 API" / "对话 · 会话 · 知识导入 · 成员 · 应用凭证".
Right, narrow maintenance lane: "独立 Ops HTTP" / "默认 :3001 · 独立维护 Token". Only the Ops card connects here. Under it: "维护能力" / "模型热切换 / 向量索引重建" / "插件 ZIP 上传 / 配置 / 启停" / "运行事件 / 轨迹图 / 错误排查". Use purple dashed control arrows toward the plugin composition boundary and event store, separate from normal request arrows. Do not depict business accounts gaining Ops rights.

Below the business API, a prominent runtime group titled "Agent Runtime · 有限步数 ReAct".
Within it show an explicit left-to-right loop:
"上下文 / 会话状态" → "Decision 决策" → "工具调用" → "Observation" with a curved return arrow from Observation to Decision.
A branch from Decision goes to "Answer 正文生成" and then "Guard / 引用与证据校验" and then "SSE 返回答案". Small nearby note: "满足策略时实时流式；其余校验后发送". Make it clear Guard participates in streaming eligibility and completion; no unsafe unconditional streaming promise.
Under tools, a child card: "RAG 知识检索" / "查询改写 → 来源选择 → 向量 + 关键词 → 融合" / "重排槽位默认 Noop".
Three supporting cards below the loop: "会话与摘要" / "事件与工具审计" / "记忆（可选）".
A horizontal process-internal band along the bottom: "Cordis 插件装配与生命周期" and smaller "core 定义接口；plugins 提供实现；bootstrap 负责组合". Small chips: "Model · Embedding · Decision · RAG · Tools · Memory · ResponsePolicy". This is dependency composition, not a mandatory sequential request hop.

OUTSIDE the server, below it, a clean row with two groups:
Left group "持久化与运行数据":
"PostgreSQL" / "账号与 Key 摘要 · 会话与事件 · 知识与审计"
"Redis" / "状态 TTL · 会话锁 · 限流"
"Qdrant" / "按租户 / 知识空间过滤的向量索引"
"Mem0（可选）" / "独立长期记忆"
Right group "外部模型服务":
"LLM · OpenAI 兼容接口" / "决策与正文共用模型服务"
"Embedding · 独立配置" / "文档与查询向量化"
"模型兼容适配" / "消息格式 · JSON · 流式参数"
Use selective connectors to runtime/storage/RAG/adapters, avoid spaghetti. Mem0 must be a dashed optional connection; do not show optional services as required. No separate required Decision LLM, no required real reranker, no direct client-to-database arrows.

BOTTOM a visually separated explanatory footer titled "数据隔离：Key 是凭证，应用与知识空间才是稳定归属".
Line 1: "Key → tenantId + applicationId + knowledgeSpaceId + permissions"
Line 2: "会话按用户或应用隔离；知识按租户与空间隔离；换 Key 不改变归属"
Small example chips: "设备 A / B → 共享 VCD 8.6 知识空间" and "后台 C → 独立 VCD 5.5 知识空间".
Last small boundary note: "当前：模型 / 插件按部署配置；知识导入已有 API，上传管理页面待补"
One small legend: "实线：请求 / 数据 虚线：维护 / 可选"
One final small mode note: "live 使用外部存储与模型；mock 替换为内存和模拟 Provider"

Prioritize legibility and factual fidelity. The overall result must be a coherent architecture image, NOT a screenshot of a webpage. No code secrets, vendor model names or specific configured API keys.

## Final edit

Preserve the entire generated diagram except two runtime connectors: remove Observation → RAG and the extra Tool ↔ Guard connection. Add a blue orthogonal connector from the bottom of Tool to the left edge of RAG, routed through the whitespace above Guard/SSE. Preserve the Tool → Observation → Decision loop and all text.
