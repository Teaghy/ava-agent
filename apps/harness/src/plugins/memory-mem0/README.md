# memory-mem0

通过 HTTP 适配自行部署的 Mem0 OSS Server。入口为 [memoryMem0Plugin](index.ts)，实现为 [Mem0Memory](rest.provider.ts)。

## 服务与配置

- 提供 `ctx.memory`（[MemoryService](../../core/memory/memory.service.ts)），无 Cordis 服务依赖。
- 与 [memory](../memory/README.md) 二选一；本插件不启动或部署 Mem0 Server。

| 参数或开关 | 环境变量       | 默认值                     |
| ---------- | -------------- | -------------------------- |
| 是否装配   | `MEM0_ENABLED` | false                      |
| `url`      | `MEM0_URL`     | `http://localhost:8888`    |
| `apiKey`   | `MEM0_API_KEY` | 空；设置时发送 `X-API-Key` |

## 使用的 REST 契约

| 方法   | 路径            | 用途                                                     |
| ------ | --------------- | -------------------------------------------------------- |
| POST   | `/memories`     | 写入单条 user message，`infer: false`，分类写入 metadata |
| POST   | `/search`       | 查询，`filters.user_id` 限定所有者，`top_k` 默认 5       |
| GET    | `/memories/:id` | 删除前核对所有者                                         |
| DELETE | `/memories/:id` | 删除所属记忆                                             |

所有者使用 `JSON.stringify([tenantId, userId])` 作为 Mem0 `user_id`，避免跨租户同名用户混淆。创建与查询响应须具有当前实现要求的 `results` 数组；部署的 Server 需符合这些接口和响应结构。

请求超时 15 秒，recall 透传运行取消信号；非成功响应映射为 `MEMORY_UNAVAILABLE`。启用时只装配适配器，不会在启动阶段验证远端健康状况。Agent 的可选记忆读取失败会记录日志。

当前使用 Node 原生 `fetch`，没有引入 `mem0ai`，也不调用托管版 `/v1` API。开启此插件不会自动把每轮对话写入记忆；需业务显式调用 `remember()`。Mem0 自身的模型与存储需单独配置，向量 collection 应与知识库分离。
