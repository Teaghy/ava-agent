# ops-console

启动时装配的内置维护插件，`OPS_ENABLED=false` 时不装配。提供独立 `ops` HTTP 服务，托管 `apps/ops` 构建产物并挂载插件管理 API；无需独立部署维护后端。

`OPS_HOST` 默认为 `127.0.0.1`，`OPS_PORT` 默认为 `3001`。只接受独立的 `OPS_API_KEYS`，无匿名模式，维护身份要求 `admin && managePlugins`。公开聊天监听不挂载维护 API，Ops 不挂载聊天业务接口。

此插件不进入可管理插件列表，`ops` 服务禁止由管理插件覆盖。Harness 启动时开启监听，任一监听启动失败会清理已启动监听，停止或 Cordis dispose 时关闭。源码开发从 Ops workspace 读取静态资源；发布产物从 `dist/ops` 读取。

同进程不能隔离插件的任意代码行为，也不能在 Harness 进程故障时提供独立恢复能力。部署、凭证、safe mode 和 SDK 说明见 [维护文档](../../../../../docs/plugin-management.md)。
