# reranker

提供可替换的重排服务，当前实现为透传。入口为 [rerankerPlugin / NoopReranker](index.ts)，Cordis 插件名为 `reranker-noop`。

## 服务与配置

- 提供 `ctx.reranker`（[RerankerService](../../core/reranker/reranker.service.ts)）。
- 无服务依赖、外部调用或插件参数。

## 行为与替换

`rerank(query, documents)` 原样返回传入文档顺序和分数。当前检索排名来自知识源与 RAG 的排名融合，没有实际的交叉编码器或外部重排模型。

接入真实重排服务时实现同一接口，处理取消信号，并在 bootstrap 中替换本 Provider。RAG 已将查询、候选文档及信号传入该接口；也允许完全不装配重排器。

参见 [rag](../rag/README.md) 与 [插件索引](../README.md)。
