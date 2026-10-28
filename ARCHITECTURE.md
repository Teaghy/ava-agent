# Agent 平台分层

本目录落实《Agent架构分层》讨论中的运行边界。目录按已有职责拆分，未实现的能力不创建空 Provider 或伪造业务页面。

```text
apps/
├── harness/
│   ├── src/
│   │   ├── bootstrap/
│   │   │   ├── context.ts                 # Typed Cordis Context / Events
│   │   │   ├── plugins.ts                 # 插件组合
│   │   │   └── bootstrap.ts               # 启动及信号处理
│   │   ├── core/
│   │   │   ├── agent/                     # agent.types、agent.service、agent-state
│   │   │   │                              # agent-decision、context-builder、limits
│   │   │   ├── model/                     # model.service / model.types
│   │   │   ├── decision/                  # decision.service / decision.types / decision.schema
│   │   │   ├── embedding/                 # embedding.service
│   │   │   ├── reranker/                  # reranker.service
│   │   │   ├── memory/                    # memory.service / memory.types
│   │   │   ├── rag/                       # rag.service / retrieval.types
│   │   │   │                              # knowledge-source / chunker / rank-fusion
│   │   │   ├── tools/                     # tool / tool-context / tool.types
│   │   │   ├── vector/                    # vector.service / vector.types
│   │   │   ├── session/                   # session.service / session.types
│   │   │   ├── event/                     # agent-event / event-store.service
│   │   │   ├── guard/                     # guard.service
│   │   │   ├── http/                      # http.service / http.types / auth
│   │   │   ├── storage/                   # storage.service
│   │   │   ├── cache/                     # cache.service
│   │   │   ├── observability/             # telemetry.service
│   │   │   ├── common.types.ts            # Principal / Metadata
│   │   │   └── index.ts                   # Context 类型汇总
│   │   ├── plugins/
│   │   │   ├── agent-loop/                # index 注册；react-loop 执行
│   │   │   ├── decision-main-model/       # 主模型 DecisionService Provider
│   │   │   ├── model-openai/              # OpenAI Compatible Provider
│   │   │   ├── model-mock/
│   │   │   ├── embedding-openai/          # 真实和 mock Embedding Provider
│   │   │   ├── reranker/                  # 当前为 Noop
│   │   │   ├── memory/                    # 内置 storage Memory Provider
│   │   │   ├── memory-mem0/               # rest.provider：自托管 Mem0 OSS
│   │   │   ├── sessions/
│   │   │   ├── event-store/
│   │   │   ├── tools/
│   │   │   │   ├── index.ts               # Cordis 注册
│   │   │   │   ├── registry.ts            # 校验、权限与审计
│   │   │   │   └── built-in/              # 知识/案例检索与 mock 业务工具
│   │   │   ├── rag/
│   │   │   │   ├── index.ts
│   │   │   │   ├── retrieval.service.ts
│   │   │   │   ├── query-rewriter.ts
│   │   │   │   └── context-selector.ts
│   │   │   ├── knowledge-registry/        # 来源注册、选择、租户边界
│   │   │   ├── knowledge-qdrant/          # 混合检索、SQL 发布校验、导入
│   │   │   ├── knowledge-cases/           # category=case 的专用来源
│   │   │   ├── storage-postgres/
│   │   │   │   ├── index.ts               # 连接生命周期
│   │   │   │   ├── db.ts                  # Drizzle 存储实现
│   │   │   │   └── schema/                # conversation / message / agent-run
│   │   │   │                              # agent-event / knowledge / tool-audit / memory
│   │   │   ├── storage-memory/
│   │   │   ├── cache-redis/
│   │   │   ├── cache-memory/
│   │   │   ├── vector-qdrant/
│   │   │   ├── vector-memory/
│   │   │   ├── guard/
│   │   │   ├── http-h3/                   # index 注册；http.service 负责 Transport
│   │   │   ├── chat-api/
│   │   │   ├── conversations-api/
│   │   │   ├── knowledge-api/
│   │   │   ├── web-static/                # 可选托管构建产物，不管理前端
│   │   │   └── observability/
│   │   ├── config/                        # env / schema
│   │   ├── prompts/
│   │   ├── fixtures/
│   │   └── index.ts
│   ├── drizzle/
│   ├── scripts/
│   ├── tests/
│   ├── drizzle.config.ts
│   └── package.json
├── web/
│   └── src/
│       ├── pages/ChatPage.tsx
│       ├── components/
│       │   ├── chat/Settings.tsx
│       │   ├── message/Message.tsx
│       │   └── citation/CitationPanel.tsx
│       ├── services/api.ts                # 仅 SDK → 页面回调适配
│       ├── lib/protocol.ts                # 仅 UI 消息状态类型
│       ├── App.tsx
│       └── main.tsx
└── admin/                                 # 独立包骨架，尚无管理界面
    ├── src/pages/README.md                 # knowledge / conversations / agents / tools
    │                                      # prompts / traces / evaluation
    └── package.json
packages/
├── protocol/src/
│   ├── chat/                              # request / response / events
│   ├── citation/
│   ├── knowledge/
│   ├── error/
│   ├── config/
│   └── index.ts
├── sdk/src/                               # client / chat / stream / knowledge / index
├── shared/src/                            # errors / utils（已有公共代码）
└── config/typescript/base.json
```

依赖方向：Web/Admin → SDK → Protocol/Shared；Harness → Protocol/Shared。Core 无 Provider SDK；插件通过 Cordis Context 组合，插件注册与服务实现分开。API 参数、输出和客户端事件均保留 Zod 校验。

决策链路：Agent Runtime → `ctx.decision` → 默认 `decision-main-model` → `ctx.model`。Runtime 只管理执行、预算、权限、Guard 和轨迹；默认决策 Provider 使用 ContextBuilder 构建模型上下文。Core 的 `decision/` 明确定义服务、输入/上下文和输出 schema；原 `agent/agent-decision.ts` 保留为兼容导出。

当前保留主模型决策行为，不增加额外模型调用。专用模型、规则和 Hybrid 可作为后续 Decision Provider 替换；粗粒度 Domain 路由是另一项独立能力，尚未实现 `ctx.router`。知识检索仍是 Tool，模型或规则返回的工具选择都不能绕过服务端权限。

知识链路：Agent → Tool → RAG → `ctx.knowledge` → KnowledgeSource → Vector/SQL/API。Registry 默认检索 `default !== false` 的来源，也可用 `sources` 选择。`cases` 仅在显式选择时使用，避免与通用来源重复检索。每个外部来源应返回全局唯一的 document/chunk ID，并在访问远端系统时落实对象级授权；Registry 再校验 tenant 和 metadata。

Working Memory 仍是 AgentState，保存在进程、Redis TTL 和 durable checkpoint 中；没有为了目录命名创建第二套状态机制。Mem0 REST Provider 保持现有行为，embedded Provider 尚未实现。

Admin、共享 UI、上传、真实 Reranker、额外知识库连接器属于后续功能。当前不提供假的管理页面，也不创建无人使用的 result/ids 工具、repository 包装或空实现。参考结构中的 ESLint 目录遵从本项目要求替换为根 oxlint/oxfmt 配置。
