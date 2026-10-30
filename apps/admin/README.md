# Admin

可选的客服业务管理示例，通过 `@ava/sdk` 调用 Harness。当前提供账号登录、成员权限，以及应用创建、知识空间绑定、一次性 Key 签发、有效期设置、即时撤销和停用。知识库上传页面后续加入。

面向业务管理员维护客服业务内容。Harness 插件发布、装配、启停和故障恢复属于独立 `apps/ops` 维护端，不放入此应用。

参与 workspace dev/build，由开启 `LOCAL_AUTH_ENABLED=true` 的 Harness 同源托管在 `/admin/`，无需新服务或端口。初始化、角色、固定 Token 迁移和部署边界见 [本地身份说明](../../docs/local-identity.md)。
