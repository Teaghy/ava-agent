# cache-memory

提供开发和测试使用的进程内缓存。入口与实现为 [cacheMemoryPlugin / InMemoryCache](index.ts)。

## 服务与配置

- 提供 `ctx.cache`（[CacheService](../../core/cache/cache.service.ts)）。
- 无服务依赖、外部连接或插件参数。
- 默认 mock 模式装配；外部基础设施模式改用 [cache-redis](../cache-redis/README.md)。

## 行为与限制

支持值读写、TTL、带所有者 token 的锁获取/续期/释放，以及固定窗口计数限流。TTL 和限流窗口单位为秒；过期值在访问时清理，读写值使用结构化克隆。

Agent 会话锁、知识导入锁、会话缓存和聊天限流共用此接口。所有状态仅保存在当前进程，重启后丢失；多个服务实例之间不共享锁与限流状态，不适用于多实例部署。

参见 [插件索引](../README.md)。
