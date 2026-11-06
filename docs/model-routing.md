# 模型分工与上下文构建

默认装配通过 `modelRouter` 按 `decision`、`answer`、`summary` 三个角色选择语言模型，通过 `contextBuilder` 准备输入。两个服务都可替换，不在 Agent 循环中绑定供应商 SDK。Embedding、Reranker 和 Mem0 仍有各自的接口及配置。

## 接入本地决策模型

保留当前默认 LLM，在根 `.env` 添加独立决策连接，然后重启 Harness：

```dotenv
DECISION_LLM_BASE_URL=http://127.0.0.1:8000/v1
DECISION_LLM_MODEL=your-local-model-id
DECISION_LLM_API_KEY=local
```

地址、端口及模型 ID 应与实际服务一致。API 应兼容 OpenAI Chat Completions；不校验认证的本地服务也需填写非空占位 Key。决策模型须稳定生成符合决策 schema 的 JSON；它只能提出动作，工具权限、预算、审计、引用和行业规则仍由 Runtime 执行。

三个连接字段须一起设置，未配置整组的角色沿用当前 `ctx.model`。不会从默认模型借用凭据并发送到另一个服务。已配置的角色调用失败时直接报告错误，不隐式切回其他服务。`mock` 部署忽略这些独立连接，继续使用模拟模型。

回答与摘要使用相同形式的 `ANSWER_LLM_*`、`SUMMARY_LLM_*`。每组还可设置 `*_LLM_MESSAGE_FORMAT`、`*_LLM_JSON_OUTPUT`、`*_LLM_STREAM_USAGE`，取值同默认 LLM 的兼容设置。例如只在本地服务不支持 JSON 参数时设置 `DECISION_LLM_JSON_OUTPUT=prompt`，结果仍会严格解析和校验。

Ops“模型配置”修改的是默认 LLM 和 Embedding；它保存的 `models.json` 只覆盖这些默认连接。角色连接从环境读取，修改后需重启；Ops 中切换默认模型会影响未分配独立连接的角色。若 `ava.config.ts` 或 Ops 安装了自定义 `modelRouter` Provider，模型选择交由该插件负责，上述角色环境变量由默认实现使用。

live 默认决策始终选择工具、追问或 `answer_ready`，最终正文交由回答角色生成。`ANSWER_STREAMING=false` 时回答角色使用非流式 `chat()`，全文生成并校验后再输出；true 时使用 `stream()`，是否实时展示仍由 Guard 和业务工具调用情况决定。`ask_user` 的追问或确认文字由决策返回；自定义 Decision 返回 `final_answer` 的兼容路径也保留。

## 摘要模型与输入预算

默认 `SESSION_SUMMARY_MODE=extractive`，继续使用无需模型的提取式滚动摘要。要使用摘要模型，显式配置：

```dotenv
SESSION_SUMMARY_MODE=model
SUMMARY_LLM_BASE_URL=http://127.0.0.1:8000/v1
SUMMARY_LLM_MODEL=your-local-model-id
SUMMARY_LLM_API_KEY=local
```

也可以只启用 model 模式、不指定独立连接，此时摘要调用当前默认 LLM。摘要仍在既有阈值达到后于后台生成，不阻塞已完成的回答；失败保留原摘要，停止服务时传播取消。生成文本只作历史背景，不写入个人长期记忆，也不更新 confirmedFacts、executedActions 等权威字段。

`DECISION_CONTEXT_TOKEN_BUDGET`、`ANSWER_CONTEXT_TOKEN_BUDGET`、`SUMMARY_CONTEXT_TOKEN_BUDGET` 可分别限制输入，未设置时沿用 `CONTEXT_TOKEN_BUDGET`。当前算法用 UTF-8 字节数加固定开销保守估算，不是供应商 tokenizer 的精确 token 数；决策还会预留 JSON schema 开销。预算过小以至于容不下系统规则、当前问题和工具描述时返回 `CONTEXT_BUDGET`，不会删除必需规则来强行发起请求。模型的实际窗口还需预留输出空间。

## 替换接口

公开类型从 `@ava/harness/plugin` 导入：

| Provider 槽位    | 接口                                                  | 责任                                                             |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `modelRouter`    | `ModelRouterService.get(role): ModelService`          | 调用时选择模型，可实现按角色路由或自定义供应商模型组合           |
| `contextBuilder` | `ContextService.build(request)`                       | 根据 purpose、系统提示词、预算和已授权快照返回消息，可同步或异步 |
| `summarizer`     | `SummarizerService.summarize(input): Promise<string>` | 将较早历史与原摘要压缩为至多 6000 字符的背景文本                 |

可在 `ava.config.ts` 的 `providers` 中固定装配，也可通过 Ops 安装对应槽位的 Provider 插件。三者均支持现有启停、失败回退和重启恢复；停用外部 Provider 后恢复应用选择或默认实现。切换会取消并等待当前任务，包括后台摘要，影响当前进程所有会话。

例如按任务准备上下文，并复用默认裁剪逻辑：

```ts
import { defaultContextService, type HarnessPlugin } from '@ava/harness/plugin';

export const compactContext: HarnessPlugin = {
  name: 'compact-context',
  provide: ['contextBuilder'],
  apply(ctx) {
    ctx.provide('contextBuilder', {
      build(request) {
        return defaultContextService.build({
          ...request,
          recent: request.purpose === 'decision' ? request.recent.slice(-6) : request.recent,
        });
      },
    });
  },
};
```

`ContextBuildRequest` 携带 `purpose`、`systemPrompt`、`tokenBudget`、当前消息、工具目录、观察、知识、历史、摘要、记忆及取消信号。它不会额外获得用户权限之外的数据，也不负责自动召回记忆或执行工具。每次调用传递隔离快照，输出需符合消息格式并通过原始预算检查；异步实现应响应 `signal`。

默认决策、回答和模型摘要都会通过上下文接口。自定义决策算法若直接调用模型，应复用导出的 `buildModelContext(service, request)`，以保留快照、输出校验和预算约束；自定义插件是受信任的进程代码，这些接口不是代码沙箱。

模型请求的观测字段 `model_role` 标记决策、回答或摘要，不记录完整上下文或模型 Key。个人记忆继续遵循可选工具、显式指令写入的规则。
