# vector-qdrant

通过 Qdrant REST SDK 实现向量存储接口。入口为 [vectorQdrantPlugin](index.ts)，实现为 [QdrantVector](qdrant-vector.service.ts)。

## 服务与配置

- 提供 `ctx.vector`（[VectorService](../../core/vector/vector.service.ts)），无 Cordis 服务依赖。
- `APP_MODE=live` 或 `INFRA_MODE=external` 时装配。

| 插件参数     | 环境变量或来源                            | 默认值                  |
| ------------ | ----------------------------------------- | ----------------------- |
| `url`        | `QDRANT_URL`                              | `http://localhost:6333` |
| `apiKey`     | `QDRANT_API_KEY`                          | 空                      |
| `collection` | `QDRANT_COLLECTION`                       | `knowledge`             |
| `dimensions` | mock 固定 64，否则 `EMBEDDING_DIMENSIONS` | live 为 1536            |

## 启动与检索

启动时自动创建不存在的 Cosine collection，校验已有 collection 维度，并建立 `tenantId` keyword payload 索引。维度不匹配会阻止启动；切换 Embedding 模型或 mock/live 模式时需使用对应 collection 并重新导入。

搜索始终附加租户与 metadata 条件，并校验返回文档结构；upsert/delete 使用 `wait: true`。SDK 请求超时 10 秒，检索边界检查取消信号。

知识库与 Mem0 应使用独立 collection。插件明确拒绝名称 `memories`，但不会读取或自动检查 Mem0 自身配置，部署时仍需核对实际名称。插件不负责关键词检索与 RAG 策略，见 [knowledge-qdrant](../knowledge-qdrant/README.md)。
