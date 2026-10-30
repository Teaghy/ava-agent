# local-identity

可选业务身份插件，依赖 http、storage、cache、telemetry，提供本地账号登录、Cookie 会话、本人改密及租户内成员管理，托管业务管理示例 `/admin/`。由 `LOCAL_AUTH_ENABLED` 开启，默认关闭，不装配在 Ops 监听。

接口与安全边界见 [本地身份说明](../../../../../docs/local-identity.md)。存储使用可选 `StorageService.identity`；不修改 Agent 执行逻辑或业务数据的租户与用户归属。
