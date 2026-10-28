# storage-memory

提供开发和测试使用的进程内持久层替身。入口与实现为 [storageMemoryPlugin / InMemoryStorage](index.ts)。

## 服务与配置

- 提供 `ctx.storage`（[StorageService](../../core/storage/storage.service.ts)）。
- 无服务依赖、外部连接或插件参数。
- 默认 mock 模式装配；外部基础设施模式改用 [storage-postgres](../storage-postgres/README.md)。

## 存储范围

保存会话归属、带引用的消息、摘要、运行状态、追加事件、工具审计、知识分片和长期记忆。会话列表按当前租户/用户过滤；会话创建和显式访问断言会检查所有者。知识按租户隔离，记忆按租户和用户隔离。

关键词检索使用简单文本命中计分；该实现主要用于跑通接口和可重复测试，不模拟 PostgreSQL 的事务、索引及性能。内部按会话 ID 操作的方法需由调用方先完成身份校验。

数据仅保存在当前进程，重启后全部丢失，不适用于持久化或多实例部署。不要因服务接口名为 Storage 就认为 mock 数据已经落盘。

参见 [插件索引](../README.md) 与 [项目启动说明](../../../../../README.md)。
