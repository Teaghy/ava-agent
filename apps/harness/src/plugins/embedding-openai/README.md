# embedding-openai

统一装配真实和模拟 Embedding。入口为 [embeddingPlugin](index.ts)，Cordis 插件名为 `embedding`。

## 服务与依赖

- 提供 `ctx.embedding`（[EmbeddingService](../../core/embedding/embedding.service.ts)）。
- 无 Cordis 服务依赖；支持 `embed()` 和批量 `embedMany()`。

## 配置

| 插件参数     | 环境变量或来源         | 默认值                      |
| ------------ | ---------------------- | --------------------------- |
| `mock`       | `APP_MODE === 'mock'`  | true                        |
| `baseURL`    | `EMBEDDING_BASE_URL`   | `https://api.openai.com/v1` |
| `apiKey`     | `EMBEDDING_API_KEY`    | 空；live 模式必须设置       |
| `model`      | `EMBEDDING_MODEL`      | `text-embedding-3-small`    |
| `dimensions` | `EMBEDDING_DIMENSIONS` | 1536，仅真实实现使用        |
| `batchSize`  | `EMBEDDING_BATCH_SIZE` | 10；按供应商与模型限制设置  |

## 行为与限制

[OpenAIEmbedding](openai-embedding.service.ts) 使用 OpenAI SDK，按响应索引恢复批次顺序，并校验返回数量、维度和数值。请求超时 30 秒、最多重试一次，透传取消信号。

批量输入按 batchSize 依次拆分，每批的索引必须覆盖 0 到 batchLength-1，重复或缺失索引会被拒绝。请求明确指定 encoding_format: float。向量服务的认证、限流和连接超时会转换为明确的 EMBEDDING_* 错误，不返回原始供应商错误内容。百炼配置、模型批量上限和新集合重建要求见 [阿里云 Embedding](../../../../../docs/aliyun-embedding.md)。

[MockEmbedding](mock-embedding.service.ts) 固定生成 64 维归一化字符哈希向量，不提供真实语义能力。mock + 外部 Qdrant 模式也使用 64 维；切换 live 模式时应选择独立 collection 并重新导入文档，避免维度冲突。

向量 collection 的配置与启动校验属于 [vector-qdrant](../vector-qdrant/README.md)。参见 [插件索引](../README.md)。
