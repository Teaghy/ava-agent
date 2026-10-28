# cache-redis

基于 ioredis 提供共享缓存、锁与限流。入口为 [cacheRedisPlugin](index.ts)，实现为 [RedisCache](redis.service.ts)。

## 服务与配置

- 提供 `ctx.cache`（[CacheService](../../core/cache/cache.service.ts)），无 Cordis 服务依赖。
- 参数 `url` 来自 `REDIS_URL`，默认 `redis://localhost:6379`。
- `APP_MODE=live` 或 `INFRA_MODE=external` 时装配，替代 [cache-memory](../cache-memory/README.md)。

## 行为与生命周期

值以 JSON 存储，所有 key 加 `ava:` 前缀。TTL 单位为秒；锁通过 `SET NX EX` 获取，Lua 脚本按所有者 token 续期或释放，限流通过 Lua 实现固定窗口计数。

插件激活时连接 Redis，连接及命令超时均为 5 秒，每个请求最多重试一次，未启用持续重连策略。连接失败会使装配失败；卸载时断开连接。

缓存用于会话/运行快照、并发锁及限流；持久化记录仍由 Storage 管理。多实例部署需连接同一 Redis，并保持一致的实例配置。参见 [插件索引](../README.md)。
