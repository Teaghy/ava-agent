# web-static

在 Harness 中托管独立 Web App 的构建产物，并返回公开客户端配置。入口与实现为 [webStaticPlugin](index.ts)。

## 依赖与配置

- 必需：`http`；不提供新的 Cordis 服务。
- 参数类型为 `WebStaticConfig`，由 bootstrap 提供，无独立环境变量读取。

| 插件参数         | bootstrap 来源                                  |
| ---------------- | ----------------------------------------------- |
| `mode`           | `APP_MODE`                                      |
| `authRequired`   | 当前鉴权配置是否允许匿名                        |
| `memoryProvider` | `MEM0_ENABLED` 决定 `mem0-oss-rest` / `storage` |
| `persistence`    | 实际基础设施选择决定 `postgres` / `memory`      |

## 静态托管与接口

把 [apps/web/dist](../../../../web/dist) 挂载到 `/`；Web 仍为独立 React/Vite App，其开发和页面生命周期不属于 Cordis。部署前从根目录执行 `pnpm build`，`pnpm dev` 也会先构建 Web。缺少产物时页面请求返回 404，API 仍可提供服务。

`GET /api/v1/client-config` 无需认证，返回经共享 schema 校验的公开配置及 `maxMessageLength=2000`，设置 `Cache-Control: no-store`。不返回 Token、模型密钥或内部连接串；Provider 字段表示已选择的实现，并不证明 Mem0 或数据库健康。

挂载和路由均通过 `ctx.effect` 注册，卸载时注销。只部署 API 或使用独立前端托管时，可在 bootstrap 中省略本插件。静态文件类型、路径限制和 CSP 由 [http-h3](../http-h3/README.md) 负责。
