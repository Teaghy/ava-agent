# storage-postgres

使用 PostgreSQL、pg 连接池与 Drizzle 实现持久层。入口为 [storagePostgresPlugin](index.ts)，实现为 [PostgresStorage](db.ts)，表定义在 [schema/index.ts](schema/index.ts)。

## 服务与配置

- 提供 `ctx.storage`（[StorageService](../../core/storage/storage.service.ts)），无 Cordis 服务依赖。
- 参数 `url` 来自 `DATABASE_URL`，默认 `postgres://ava:ava@localhost:5432/ava`。
- `APP_MODE=live` 或 `INFRA_MODE=external` 时装配，替代内存存储。

## 初始化与迁移

从仓库根目录执行：

```bash
docker compose up -d
pnpm db:migrate
```

迁移历史保留在 [drizzle](../../../drizzle/)。插件启动只执行连接检查，不自动运行迁移。修改表定义后通过 `pnpm db:generate` 生成迁移，检查 SQL 后再应用到目标环境。

连接池最多 10 个连接，连接超时 5 秒，语句超时 10 秒；激活时执行 `select 1`，卸载时关闭连接池。数据库不可用会使插件装配失败。

## 数据与隔离

持久化会话/消息/引用、摘要、运行检查点、追加事件、工具审计、知识文档/分片和长期记忆。会话归属由服务端 Principal 校验，事件与知识按租户过滤，记忆按租户和用户过滤；内部会话 ID 读写需在完成归属检查后调用。

知识发布在 SQL 事务内更新文档和分片，但不与 Qdrant 组成跨系统事务。关键词搜索使用参数化 `ILIKE`、租户与 metadata 条件，不是 BM25。追加事件的更新/删除限制由迁移安装的数据库触发器提供。

参见 [knowledge-qdrant](../knowledge-qdrant/README.md)、[event-store](../event-store/README.md) 与 [插件索引](../README.md)。
