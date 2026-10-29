# 客服插件开发

默认 `pnpm dev` 启动客服流程；也可选择知识问答或自由聊天预设，再通过配置和插件替换算法、连接知识库和业务系统。默认 mock 客服演示使用虚构设备资料，应用默认值与覆盖规则见 [应用预设](application-presets.md)。

独立插件项目由维护人员通过 [Harness Ops 插件维护](plugin-management.md) 加载已构建 JS，无需放进 Harness 源码。Ops 默认关闭，独立于客户和业务管理端。日常启动读取根 `ava.config.ts`（开发）或 `.ava/ava.config.js`（生产）作为固定装配，并恢复维护页保存的登记。下面的公开 API 仍可用于程序化装配。

## 公开入口

- `@ava/harness`：`createHarness`、`loadConfig`、配置 schema 和装配类型。导入不会启动 HTTP。
- `@ava/harness/plugin`：带 Ava 服务声明的 `Context`、`HarnessPlugin`、决策/知识/工具/记忆等领域接口、`decisionSchema`、`ContextBuilder`、`AppError`、`checkAbort`。
- `@ava/sdk`：独立 HTTP 客户端，供 Web 或其他进程使用。

当前包为 workspace 私有包，版本 `0.1.0`，尚未发布 npm。插件包声明 `"@ava/harness": "workspace:*"`，先构建 Harness；不要通过 `../../apps/harness/src` 引入内部实现。生成的 `.d.ts` 随构建输出。公开入口的破坏性修改需要同步版本与迁移说明；当前不承诺跨版本插件二进制兼容。

## 替换 Provider

`createHarness(config, options)` 的 `providers` 在启动前选择实现，指定槽位后不挂载该槽位的默认 Provider。每个槽位只能选一个实现。

| 槽位             | 服务接口           | 默认实现                         |
| ---------------- | ------------------ | -------------------------------- |
| `decision`       | `DecisionService`  | 主模型结构化决策                 |
| `model`          | `ModelService`     | mock 或 OpenAI Compatible        |
| `embedding`      | `EmbeddingService` | mock 或 OpenAI Compatible        |
| `reranker`       | `RerankerService`  | 透传                             |
| `rag`            | `RagService`       | 查询改写、融合、重排、上下文选择 |
| `memory`         | `MemoryService`    | 内置存储或 Mem0                  |
| `responsePolicy` | `AnswerPolicy`     | 当前预设的回答证据策略           |
| `storage`        | `StorageService`   | 内存或 PostgreSQL                |
| `cache`          | `CacheService`     | 内存或 Redis                     |
| `vector`         | `VectorService`    | 内存或 Qdrant                    |

以下为可运行的无模型决策装配形式：

```ts
import { createHarness, loadConfig } from '@ava/harness';
import type { HarnessPlugin } from '@ava/harness/plugin';

const rules: HarnessPlugin = {
  name: 'order-decision',
  provide: ['decision'],
  apply(ctx) {
    ctx.provide('decision', {
      async decide(_input, context) {
        context.signal.throwIfAborted();
        return { type: 'ask_user', question: '请提供订单号。' };
      },
    });
  },
};

const harness = await createHarness(loadConfig(), {
  providers: { decision: rules, model: false },
  demoTools: false,
});
await harness.start();
// 进程关闭时 await harness.stop()。
```

只有 `model` 可以显式设为 `false`，且必须同时提供自定义 `decision`。若自定义决策仍注入 `model`，启动会报告依赖未就绪。其他槽位继续使用默认实现或明确的替代 Provider。

`loadConfig` 校验字段、鉴权和运行模式；默认外部 Provider 的凭据在 `createHarness` 装配前校验。使用默认 live 模型/Embedding 时仍必须提供各自的 Key；自定义 Provider 自行校验凭据，不需要填写无关的 OpenAI Key。live 默认仍连接外部基础设施，不会静默降级。

## 追加能力

`options.plugins` 安装原生 Cordis 插件，适合注册知识源、工具、答案策略和新服务。不要在此重新声明底座管理的服务；替换服务应使用上面的 `providers`。

```ts
const capabilities: HarnessPlugin = {
  name: 'my-industry',
  inject: ['tools', 'knowledge', 'guard'],
  apply(ctx) {
    ctx.effect(() => ctx.knowledge.register(myKnowledgeSource));
    ctx.effect(() => ctx.tools.register(myBusinessTool));
    ctx.effect(() => ctx.guard.register(myAnswerPolicy));
  },
};

// 将 capabilities 放入 createHarness 的 plugins: [capabilities]。
```

其中 `myKnowledgeSource`、`myBusinessTool`、`myAnswerPolicy` 由业务代码实现，完整例子见 [零售插件](../examples/retail/src/retail.ts)。服务依赖使用 `inject` 声明，注册使用 `ctx.effect` 持有 disposer，Cordis 管理激活、依赖失效和卸载。

插件配置建议用工厂函数接收、校验并绑定：`createIndustryPlugin(config): HarnessPlugin`。工厂可使用 Zod 校验 URL、阈值等参数，返回无启动参数的原生插件；不需要额外插件 manifest 或另一套 DI。内置 Provider 的配置仍由原生 Cordis 插件参数传入。

## 决策与 Runtime 的边界

`DecisionService.decide(input, context)` 获得任务、权限范围内的工具目录、知识源目录、近期消息、观察、记忆、检索文档和取消信号。

- 输入数据是快照，修改它们不会更新 Runtime 的证据、权限或状态；每步决策只通过返回值提出动作。
- 返回值必须符合 `decisionSchema`：`tool_call`、`ask_user`、`final_answer`。额外字段（包括 reasoning）会被拒绝。
- Runtime 统一执行步骤/工具/检索预算、权限检查、审计、Guard、检查点和输出。决策算法不应自行执行有副作用的业务操作。
- 规则 Provider 不需要模型；模型决策可使用自定义 `ModelService` 或 `ContextBuilder`。

默认 Runtime 通过 `AgentDependencies` 接收领域服务，内部不依赖 Cordis。当前公开装配入口不支持替换 `agent`、会话、权限、事件存储或基础 Guard；新增可替换位置应先定义其执行契约。

## 知识与自研检索

只想换数据源时，实现 `KnowledgeSource`；只想换重排时，替换 `reranker`；需要接管整套检索算法时，替换 `rag`。外部知识无需先导入本地数据库。

`KnowledgeSource` 负责实际数据访问和授权，返回带租户、全局唯一文档/分片 ID、来源和元数据的结果。Registry 还会检查租户与 metadata filter。`default: false` 的来源仅在显式指定 `sources` 时使用。

自定义检索工具应声明 `kind: 'retrieval'`，执行同样计入 `MAX_RAG_SEARCHES`，不依赖工具名称。工具返回的文档还应按内置检索工具的方式写入 `context.state.retrievedDocuments`，供引用验证使用；纯检索结果不会被当作业务操作成功的证据。更推荐复用 `knowledge_search`，在其下替换来源或 RagService，避免重复实现结果合并和事件。

业务工具须声明权限与严格输入 schema。执行时使用服务端 `context.principal` 校验具体订单、设备等对象的归属；不得从模型参数取租户或用户身份。写工具的幂等键、结果核对和人工授权由业务适配器落实。

## 追加行业校验

Runtime 将基础 Guard 声明为强依赖。引用真实性不可关闭，证据要求由 `responsePolicy` Provider 决定；追问不要求知识证据，但两种响应都必须执行行业策略。行业策略通过 `ctx.guard.register({ name, validate })` 追加，`validate` 第 5 个可选参数为 `responseType`（`final_answer` / `ask_user`），便于区分规则：

- `validate(answer, citations, state, signal)` 可为同步或异步，返回成功表示通过，抛错阻止答案保存和输出。
- 依注册顺序执行；重名策略报错。每次校验固定策略列表，每个策略接收独立的数据快照。
- 使用 `ctx.effect` 注册后，卸载插件会注销策略。外部审核请求应传递 `signal` 并设置自身网络超时。
- 基础校验失败后不会执行后续策略；追加策略不能关闭基础校验，也不能通过修改参数重写答案。

演示工单的动作一致性规则由演示业务插件注册；真实工单插件应根据自己的工具名称、结构化结果和业务状态实现策略。Guard 不提供通用逐句事实验证。

## 启动、停止与错误

- `systemPrompt` 可替换默认主模型提示词；自定义 Decision 是否使用它，由该 Provider 自己决定。
- `demoTools` 在 mock 中默认开启，可关闭；live 中始终关闭，显式开启会在连接基础设施前报错。
- Provider 必须声明 `provide` 并实际发布对应服务。冲突报 `INVALID_PROVIDER` / `PLUGIN_SERVICE_CONFLICT`；依赖缺失报 `PLUGIN_NOT_READY`，包括等待插件和 inject 名称；未发布服务报 `PROVIDER_NOT_READY`。
- `startupTimeoutMs` 默认 30000，异步激活超过期限报 `PLUGIN_STARTUP_TIMEOUT` 并启动清理。清理会等待插件自己的初始化/释放过程，因此整个失败返回可能超过此期限。插件必须自行限制网络等待，底座无法强制终止不合作的同进程代码。
- `harness.stop()` 可重复调用：停止 HTTP，取消并等待当前 Agent 任务，再卸载插件和连接。`agent.stop()` 后旧服务对象拒绝新运行。取消是协作式的，模型、工具和异步策略应响应 `AbortSignal`。
- 可视化管理支持参数更新、启停和 Provider 切换，失败会尝试恢复旧装配；不响应取消/释放的第三方代码会进入需重启的恢复状态。暂不提供源码热更新、npm 下载或在线插件市场；绕过管理层手动卸载扩展，应先结束相关请求。

插件是受信任的服务端代码，拥有进程权限；这些接口和快照用于明确责任、避免状态误改，不是运行不可信插件的沙箱。

## 独立行业示例与验收

运行 `pnpm example:retail`。示例使用独立 workspace 包和公开导出，关闭设备演示工具及模型，接入规则决策、自定义知识源、订单查询和追加行业审核，执行后自动停止。数据和来源 URL 均为虚构演示。

`pnpm test` 同时验证原默认客服路径与零售插件：订单查询、知识引用、租户/用户隔离、审核阻断、卸载清理、Provider 替换、启动失败和运行取消。编写新插件时，应增加自身服务协议与业务权限的测试。

当前检查点仍用于诊断和恢复状态读取；数据库状态和 checkpoint 事件尚未合并为单事务，也未实现自动续跑。这些能力需要单独设计，不能从“支持插件”推导出业务写入可以安全重试。
