# 阿里云百炼 Embedding

使用现有 OpenAI 兼容 Embedding Provider，无需新增一套向量接口。LLM 的地址、模型和 Key 可以与 Embedding 独立配置。

当前北京地域测试配置如下，逐项编辑根 `.env`，不要覆盖已有身份及主模型配置：

```dotenv
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_API_KEY=
EMBEDDING_MODEL=qwen3.7-text-embedding-flash
EMBEDDING_DIMENSIONS=1024
EMBEDDING_BATCH_SIZE=20
QDRANT_COLLECTION=knowledge_aliyun_qwen37_flash_1024
```

Key 填写北京地域的百炼 API Key。北京 DashScope 兼容域名仍可使用；若已有业务空间专属域名，可将地址替换为 `https://<业务空间ID>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。不在地址末尾追加 `/embeddings`，SDK 会补充路径。官方说明：[接入地址](https://help.aliyun.com/zh/model-studio/base-url)、[Embedding 接口](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)、[模型与批量限制](https://help.aliyun.com/zh/model-studio/embedding)。

`qwen3.7-text-embedding-flash` 默认 1024 维，单批最多 20 条；`text-embedding-v3/v4` 的单批上限为 10，切换时应同步调整 EMBEDDING_BATCH_SIZE。Provider 按批次依次调用、恢复每批响应索引顺序，并检查数量、索引、维度和数值；显式使用 float 编码。无效响应不会被拼接成成功结果。

即使维度相同，不同模型的向量也不能直接混用。更换模型应使用独立 Qdrant 集合，并使用新模型为现有已发布知识分片重新计算向量，保留原分片 ID、元数据和租户范围。旧集合保留以便回退。本次本地测试已迁移 demo 租户的 10 篇文档、50 个现有分片，没有删除旧集合；其他部署和租户需要分别完成重建。

修改配置并完成索引准备后重启服务。接口认证失败、超时、限流/额度不足分别返回 EMBEDDING_AUTH_FAILED、EMBEDDING_TIMEOUT、EMBEDDING_RATE_LIMITED；错误可在 Ops 的工具结果中查看，不输出供应商原始错误或密钥。检索正常后再验证完整客服问答，避免把主模型正常调用等同于知识库可用。
