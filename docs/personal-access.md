# 内部试用身份配置

所有聊天与会话接口都要求个人 Token，包括 mock 模式。没有配置 `API_KEYS` 时，静态页面和公开服务配置仍能打开，聊天与会话接口返回 401。

## 为每位使用者配置身份

为每个人分别执行一次，生成随机 Token：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

将结果分别替换下面的占位值，在根 `.env` 中配置为一行 JSON：

```dotenv
API_KEYS={"<alice-random-token>":{"tenantId":"demo","userId":"alice","permissions":["READ"]},"<bob-random-token>":{"tenantId":"demo","userId":"bob","permissions":["READ"]}}
```

同公司可以使用相同 tenantId，每位员工使用不同 userId，不要共享 Token 或员工身份。演示知识默认属于 demo 租户；修改公司租户时也要按目标租户导入资料，或相应修改 SEED_TENANT_ID。

重启服务后，使用者在聊天页面“连接与服务”中填写自己的 Token。会话列表、历史与长期记忆按身份隔离。切换 Token 会清除页面里的旧身份会话和正在执行的请求。已有匿名 demo-user 数据不会自动迁移到员工身份。

## 单独授权 Ops

Ops 使用独立的凭证映射，不能复用任何业务 Token。例如：

```dotenv
OPS_ENABLED=true
OPS_API_KEYS={"<reviewer-random-token>":{"tenantId":"demo","userId":"reviewer","permissions":[],"inspectRuns":true},"<operator-random-token>":{"tenantId":"platform","userId":"operator","permissions":[],"admin":true,"managePlugins":true}}
```

- 只读排障：`inspectRuns:true`，可以进入运行排查，不能读写插件管理接口。
- 插件维护：`admin:true` 与 `managePlugins:true`，不自动获得运行排查权限。
- 同时需要两种能力时，显式配置这三项标识。
- 跨租户排查额外配置 `inspectTenants:["company-a"]`；默认只可排查身份所属租户。

Ops 通过 `/api/v1/ops/access` 获取可用功能，并展示相应导航。修改 URL 不会授予权限，后端每次请求都会重新校验。业务端旧的 `/api/v1/runs/replay` 已移除，轨迹仅通过 Ops 的脱敏查询接口读取。

## 撤销与轮换

从配置删除某人的 Token 并重启服务，会拒绝之后使用该 Token 的请求。轮换时生成新的随机 Token、替换旧值并重启。清除浏览器中的 Token 只表示退出当前页面，不会撤销服务端凭证，也不会取消其他已经认证并开始执行的请求。

这是内部试用的个人凭证方案，暂未接入企业单点登录、自动过期和账号管理页面。真实 Token 只保存在部署配置中，不提交版本库，通过私密渠道分别交付给本人。
