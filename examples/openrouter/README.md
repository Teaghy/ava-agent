# OpenRouter 客服示例

本示例使用真实模型和本地 PostgreSQL、Redis、Qdrant，测试资料使用虚构的澄风 CF-A200 知识库。

| 用途              | 模型                                         |
| ----------------- | -------------------------------------------- |
| 回答与 Agent 决策 | `nvidia/nemotron-3.5-super-vl:free`          |
| Embedding         | `nvidia/nemotron-3.5-embed-1b:free`，2048 维 |

统一 API 地址为 `https://openrouter.ai/api/v1`。决策默认复用主模型，无需第三套配置。`respan/span-01-lite:free` 的官方用途是行为评分，本示例不将它作为生成 Agent 决策的模型。

模型资料：[Nemotron 3.5 Super VL](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free)、[Nemotron Embedding](https://openrouter.ai/nvidia/nemotron-3.5-embed-1b:free)、[Span-01 Lite](https://openrouter.ai/respan/span-01-lite:free)。

## 本地配置

配置文件是**仓库根目录 `.env`**。如果已经为你创建该文件，直接编辑即可；否则将本目录 `.env.example` 复制为根 `.env`，再按根 `.env.example` 的身份配置说明生成独立业务和 Ops Token。不要覆盖已有部署配置。

在根 `.env` 的两处填写同一个 OpenRouter API Key：

```dotenv
LLM_API_KEY=在这里填OpenRouter的Key
EMBEDDING_API_KEY=在这里填同一个Key
```

`API_KEYS` 是聊天和知识管理的本地访问身份，`OPS_API_KEYS` 是维护身份，均不是 OpenRouter Key。本地准备流程已生成的 Token 也在根 `.env` 中；聊天使用业务 Token，Ops 使用维护 Token。`.env` 被 Git 忽略，不会随分支提交。

配置使用 `APP_MODE=live`，所以需要真实基础设施。Qdrant 使用独立集合 `knowledge_openrouter_2048`，插件使用独立状态文件 `data/openrouter/plugins.json`，避免旧 mock 向量和固定追问示例插件影响本次测试。默认 VCD-2000 自动种子已关闭。

## 启动与测试

从仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
docker compose up -d
pnpm --filter @ava/harness... build
pnpm db:migrate
pnpm dev
```

迁移会更新 `.env` 指向的数据库结构；确认使用本地测试数据库。模型 Key 和业务 Token 必须先填写好，否则 live 服务无法正常使用。

启动后，按照[澄风知识库导入说明](../customer-service-knowledge/README.md#导入当前服务)导入 `documents.json` 的 10 篇资料，使用根 `.env` 中具有 `admin:true` 的业务 Token。聊天用户与知识导入身份必须属于同一租户。`evaluation.json` 用于检查回答，不作为知识导入。

- 聊天：`http://127.0.0.1:3000/`，填写业务 Token。
- Ops：`http://127.0.0.1:3001/#runs`，填写独立维护 Token。
- 先问“CF-A200 出现 E01 怎么处理？”，再检查检索资料、回答引用和运行轨迹。

如果返回 `401`，先区分是本地业务/Ops 身份认证，还是 OpenRouter Provider 认证；`429` 或无可用 Provider 需要检查 OpenRouter 返回的限流或模型可用性。填入 Key 前，尚不能验证真实服务支持的 JSON 决策输出和 Embedding 参数。
