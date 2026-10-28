# Harness 插件

插件由 [bootstrap/plugins.ts](../bootstrap/plugins.ts) 统一装配。每个插件目录中的 README 说明其职责、Cordis 服务依赖、配置及当前限制。

## 插件索引

| 分类       | 插件                                                 | 提供的服务或注册的能力             |
| ---------- | ---------------------------------------------------- | ---------------------------------- |
| 运行与决策 | [agent-loop](agent-loop/README.md)                   | `agent`，执行循环、限额、检查点    |
| 运行与决策 | [decision-main-model](decision-main-model/README.md) | `decision`，主模型结构化决策       |
| 模型       | [model-openai](model-openai/README.md)               | `model`，OpenAI 兼容接口           |
| 模型       | [model-mock](model-mock/README.md)                   | `model`，确定性演示实现            |
| 模型       | [embedding-openai](embedding-openai/README.md)       | `embedding`，真实或模拟向量化      |
| 检索       | [knowledge-registry](knowledge-registry/README.md)   | `knowledge`，知识源注册与路由      |
| 检索       | [knowledge-qdrant](knowledge-qdrant/README.md)       | `qdrantKnowledge`，混合检索与导入  |
| 检索       | [knowledge-cases](knowledge-cases/README.md)         | 注册 `cases` 知识源                |
| 检索       | [rag](rag/README.md)                                 | `rag`，查询改写、融合、上下文选择  |
| 检索       | [reranker](reranker/README.md)                       | `reranker`，当前为透传实现         |
| 工具与校验 | [tools](tools/README.md)                             | `tools`，知识工具、模拟业务工具    |
| 工具与校验 | [guard](guard/README.md)                             | `guard`，答案依据与引用校验        |
| 会话与记忆 | [sessions](sessions/README.md)                       | `sessions`，消息、摘要、运行检查点 |
| 会话与记忆 | [event-store](event-store/README.md)                 | `eventStore`，事件追加与回放       |
| 会话与记忆 | [memory](memory/README.md)                           | `memory`，基于 Storage 的长期记忆  |
| 会话与记忆 | [memory-mem0](memory-mem0/README.md)                 | `memory`，Mem0 OSS REST 适配       |
| 存储       | [storage-memory](storage-memory/README.md)           | `storage`，进程内存储              |
| 存储       | [storage-postgres](storage-postgres/README.md)       | `storage`，PostgreSQL / Drizzle    |
| 缓存       | [cache-memory](cache-memory/README.md)               | `cache`，进程内缓存与锁            |
| 缓存       | [cache-redis](cache-redis/README.md)                 | `cache`，Redis 缓存、锁与限流      |
| 向量       | [vector-memory](vector-memory/README.md)             | `vector`，进程内向量检索           |
| 向量       | [vector-qdrant](vector-qdrant/README.md)             | `vector`，Qdrant 向量检索          |
| 可观测性   | [observability](observability/README.md)             | `telemetry`，日志与 OTLP traces    |
| Web        | [http-h3](http-h3/README.md)                         | `http`，HTTP、SSE、静态资源        |
| Web        | [chat-api](chat-api/README.md)                       | 聊天 SSE 接口                      |
| Web        | [conversations-api](conversations-api/README.md)     | 会话列表与历史接口                 |
| Web        | [knowledge-api](knowledge-api/README.md)             | 知识导入与运行回放接口             |
| Web        | [web-static](web-static/README.md)                   | Web 构建产物与公开客户端配置       |

## 装配与配置

- 插件通过 `provide` 声明服务、通过 `inject` 声明依赖，由 Cordis 管理激活与卸载；路由、知识源和工具使用 `ctx.effect` 注册清理函数。
- 环境变量由 [配置层](../config/schema.ts) 校验，再由 bootstrap 转换为插件参数。修改根目录 `.env` 后需重启服务。
- `APP_MODE=mock` 默认使用模拟模型、64 维模拟 Embedding 和内存基础设施；`INFRA_MODE=external` 可在模拟模型下使用 PostgreSQL、Redis、Qdrant。
- `APP_MODE=live` 使用真实模型和外部基础设施，需要模型凭据及 `API_KEYS`。业务工具仍是模拟实现；重排器仍然透传。
- 同一服务的替代 Provider 应择一装配，例如 `model-mock` / `model-openai`、`memory` / `memory-mem0`。替换实现时保持 [core 接口](../core/index.ts) 不变，并同步 bootstrap。
- 新知识源实现 [KnowledgeSource](../core/rag/knowledge-source.ts)，在插件中通过 `ctx.effect(() => ctx.knowledge.register(source))` 注册，无需修改 Agent 循环。

启动、鉴权示例和验证命令见 [项目 README](../../../../README.md)；模块边界见 [架构说明](../../../../ARCHITECTURE.md)。测试使用 Vitest，lint 使用 oxlint，格式化使用 oxfmt。
