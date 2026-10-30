# Ops 模型配置

live 部署可在独立 Ops 端口的 `/#models` 配置 OpenAI 兼容的语言模型和向量模型，无需重启 HTTP 服务。该配置作用于整个平台，所有租户共用；模型 API Key 与登录聊天端、Ops 的访问 Token 是不同凭据。

## 使用

1. 启用 `OPS_ENABLED=true`，使用 `OPS_API_KEYS` 中具有 `admin:true`、`managePlugins:true` 的维护 Token 连接 Ops。
2. 打开“模型配置”，填写 Base URL、模型名称和供应商 Key。LLM 用于决策及最终回答；Embedding 另有向量维度和每批文本数。
3. 点击“验证并应用”。任务状态依次展示等待、连接验证、必要的知识重建及应用结果。应用会取消正在生成的回答，并暂时拒绝新对话请求与知识导入。已开始的知识导入先完成，超时则放弃本次切换。
4. 应用完成后后续请求立即使用新配置。Key 输入留空保留现有值；勾选清除后停止对应模型调用，直到重新填写有效 Key。

首次启动读取根 `.env`。Ops 保存成功后，默认写入 `data/models.json`（与 `PLUGIN_STATE_PATH` 同目录），后续启动优先读取该文件，页面展示配置来源和版本。该文件含供应商密钥，与 `.env` 一样应限制访问、持久保存且不要提交到仓库。API 不回传密钥；浏览器不保存模型密钥。

Base URL 只接受 HTTP(S)，不能包含 URL 用户名、密码、查询参数或片段。语言模型须支持 Chat Completions 和项目要求的结构化结果；开启 `ANSWER_STREAMING` 时还须支持流式正文。保存时使用含系统规则、历史问答和追问的多轮请求验证决策结果，再验证流式正文和正常结束，任务显示各项检查结果。Embedding 须支持 OpenAI 兼容 Embeddings API。此模块不切换协议类型，也不配置独立决策、Reranker 或 Mem0 模型。

## 高级兼容设置

语言模型卡片中的折叠入口提供三项覆盖选项，默认均为 `auto`：

| 配置         | 自动规则的默认行为                  | 可选覆盖                                          |
| ------------ | ----------------------------------- | ------------------------------------------------- |
| 消息格式     | 保留原消息结构                      | 单条 system 置顶，或明确保持原结构                |
| JSON 输出    | 发送 `response_format: json_object` | 仅用提示词约束，仍严格解析 JSON 并校验决策 Schema |
| 流式用量参数 | 发送 `stream_options.include_usage` | 关闭该参数，仍使用真实正文流并检查正常结束        |

`model-compatibility` 插件按服务地址和模型名称匹配已知能力配置。当前仅内置本项目已验证的 `https://discovery-api.intern-ai.org.cn/v1` + `qwen3.8-27b` 单条 system 置顶规则；同名模型的其他部署保持默认行为。页面展示当前生效的能力、来源（默认、已知规则、人工覆盖）和匹配规则。未知部署接入测试失败时，页面给出具体兼容项提示，维护人员可覆盖后重新验证；不会让业务 Agent 自己重写请求或自动重跑业务工具。

页面更换地址或模型时，兼容选项恢复自动；API 客户端未发送 compatibility 字段时，同一连接保留已有选项，连接身份变化则恢复自动。修改兼容设置不会重建知识库索引。配置与模型 Key 一同持久保存，旧的 `models.json` 无需迁移，缺省兼容字段按自动读取。

根 `.env` 的默认值对应 `LLM_MESSAGE_FORMAT`、`LLM_JSON_OUTPUT`、`LLM_STREAM_USAGE`，取值见 `.env.example`。Ops 保存后仍优先使用保存的整组配置。

扩展规则可由原生 Cordis 插件注册，不需要更改 Agent：

```js
export default {
  name: 'company-model-profile',
  inject: ['modelCompatibility'],
  apply(ctx) {
    ctx.effect(() =>
      ctx.modelCompatibility.register({
        id: 'company-strict-model',
        label: '公司模型服务的已验证模板',
        connection: { baseURL: 'https://models.example.com/v1', model: 'company-model' },
        capabilities: { messageFormat: 'single-system-first', streamUsage: false },
      }),
    );
  },
};
```

注册扩展遵循已有插件安装、权限和生命周期规则；停用扩展后移除其规则，自动配置恢复下一条匹配规则或默认值。直接构造 `OpenAICompatibleModelService` 可传入 compatibility 选项；独立自定义 ModelService Provider 负责自己的兼容策略。

mock 部署仍使用内置模拟模型，本页只展示配置。使用自定义 model、embedding、vector、rag Provider 时，本页禁止在线应用，避免覆盖插件契约。停用对应的外部 Provider，或由应用开发者调整固定装配后再使用。

## 向量模型切换

更换 Embedding 地址、模型名称或维度时，服务会自动扫描 SQL 中所有租户已发布的知识分片，以新模型生成向量，写入新的 Qdrant collection。文档、分片 ID、内容、租户和元数据均保留。仅修改 Key 或批次大小不会重建。

重建全部成功且配置文件保存成功后，才一起切换 Embedding 与向量索引。验证、重建或保存失败，原模型及索引继续使用；失败任务可修正参数后重试。Agent 恢复失败时关闭执行入口并恢复此前配置文件，需要重启排查。切换和重建暂不支持跨多个 Harness 实例协调，适用于单实例部署。

旧 collection 和失败任务生成的 collection 不自动删除，以保留恢复依据；维护人员确认不再使用后可自行清理。外部知识源、Mem0 中的长期记忆使用各自索引，不参与本次重建。自定义存储需要实现按 ID 游标分页的 `scanKnowledgeChunks(afterId, limit)`，否则重建会拒绝执行。

需要恢复 `.env` 默认配置时，先停止服务，备份并移走 `models.json`，再启动。应确保 `.env` 的 Embedding 模型、维度与 `QDRANT_COLLECTION` 中已有向量匹配；不要在运行中编辑状态文件。

## 接口

仅独立 Ops 监听提供以下接口，均要求 `admin && managePlugins`：

- `GET /api/v1/ops/models`：配置元数据、Key 是否存在、配置版本和最近任务状态；`Cache-Control: no-store`。
- `POST /api/v1/ops/models/apply`：提交 `revision` 及要更改的 `llm`、`embedding`；返回 `202`，轮询 GET 查询结果。Key 字段省略表示保留，`null` 表示清除。并发任务、过期版本返回 `409`。

`@ava/sdk` 提供 `client.models.get(signal?)`、`client.models.apply(input, signal?)`。任务进度仅保留在当前进程，已生效配置会持久保存。
