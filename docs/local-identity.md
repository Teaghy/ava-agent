# 本地账号与业务管理

Agent 底座统一验证 Principal（tenantId、userId、权限）；可选 `local-identity` 插件提供本地账号、登录会话和成员 API。客服示例的业务管理页面在 `apps/admin`，Ops 继续独立使用 `OPS_API_KEYS`。未开启本地登录时，现有部署和静态 Token 行为保持不变。

外部系统或设备不必使用本地账号，可用 [应用 Key](application-access.md) 接入并自行管理最终用户。应用 Key 不能登录或管理本地账号。

## 开启与初始化

根 `.env` 配置 `LOCAL_AUTH_ENABLED=true`。持久化部署执行：

```bash
pnpm db:migrate
pnpm identity:admin
pnpm build
pnpm start
```

初始化命令在交互式终端询问租户 ID、用户 ID、显示名称与密码；密码输入隐藏，不通过命令行参数或日志传递。它仅创建新管理员，不覆盖已有账号。需要恢复已有账号时，可临时配置同租户另一身份的业务管理员 API Token，在管理页面重置；完成后删除临时凭证。命令读取根 `.env`，需要 PostgreSQL；纯内存 mock 下请用已有业务管理员 Token 初始化账号，重启后账号和会话也会丢失。

打开 `http://127.0.0.1:3000/admin/`（实际端口随 PORT），使用刚创建的账号登录。页面可添加成员、修改角色、启停账号及重置密码。也可在登录页展开“使用现有管理员 Token 迁移”，使用 `API_KEYS` 中 `admin:true` 的业务凭证创建本地账号；此迁移凭证仅保存在页面内存，刷新后不保留。Ops Token 不能用于此入口。

客服端“连接与服务”支持账号登录、退出和修改本人密码。账号与业务后台使用同源会话；业务后台无需独立监听端口。修改 `.env` 开关后需要重启一次，之后成员和密码修改即时生效，无需重启。

## 角色边界

| 角色             | 使用客服 | 导入知识 | 管理本租户成员 | Ops |
| ---------------- | -------- | -------- | -------------- | --- |
| tenant-admin     | 是       | 是       | 是             | 否  |
| knowledge-editor | 是       | 是       | 否             | 否  |
| agent            | 是       | 否       | 否             | 否  |

业务账号的工具权限当前为 READ，不因为业务管理员角色而获得 WRITE、CRITICAL。知识管理页面后续单独实现；本阶段只开放已有知识导入 API 的对应权限。成员管理的 tenantId 来自服务端认证身份，请求不能指定其他租户或维护权限。账号不可通过管理页面删除，也不能修改租户和用户 ID；管理员不能停用自己或移除自己的管理员角色。每页显示 50 位成员，可加载下一页。

## 固定 Token 迁移与旧数据

创建账号时填写原 API_KEYS 中相同的 tenantId、userId，原会话、知识与记忆归属不变，不改写业务数据。不要用显示名称替代原 userId。

Bearer Token 继续用于现有脚本与集成；显式无效 Token 不回退到 Cookie。开启本地登录后，如果 Token 身份已有同名本地账号，停用账号也会拒绝该业务 Token，角色变更不会让 Token 保留已移除的成员或知识管理权限。未创建同名账号的旧 Token 仍按原配置生效。密码修改或退出只撤销本地登录会话，不撤销独立的静态 Token；迁移后应从 API_KEYS 移除不再使用的个人凭证，重启生效。

Ops 凭证始终独立，不受业务账号角色授予，也不使用业务 Cookie。

## 会话与部署

会话为 32 字节随机不透明凭证，数据库只保存 SHA-256 摘要；Cookie 为 HttpOnly、SameSite=Strict、host-only，路径 `/api/v1`，固定有效期 8 小时，不滑动续期。生产模式额外设置 Secure，必须通过 HTTPS 访问（可由反向代理终止 TLS，保留原 Host）。账号密码使用 Node 原生 scrypt，独立随机盐，N=32768、r=8、p=3，参数来自 [OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。密码长度为 12–128 字符；并发哈希最多 4 个，超过返回 429。登录限流为每账号 15 分钟 10 次、全局每分钟 100 次；未知账号执行相同哈希计算并返回相同错误。生产入口仍应配置适合实际规模的网络限流。

Cookie 写请求（含登录、退出、修改密码）检查 Origin 和 Host，拒绝缺失 Origin、跨站和生产环境的非 HTTPS Origin；浏览器必须通过同源页面访问。自定义 HTTP Provider 接入本地登录时需要传递 `HttpRequest.method`、Host、Origin、Cookie，以及响应 Set-Cookie。Bearer API 调用不依赖 Cookie，不要求 Origin。

账号版本随角色、启停、密码变更原子递增，旧版本会话在下一次请求失效；并发编辑使用版本检查，冲突返回 409。退出撤销当前会话，修改密码撤销该账号所有本地会话。停用、撤销不会中断已经通过认证的在途 Agent 执行。页面重新获得焦点和每 30 秒检查身份，切换或失效时清空旧身份视图。过期会话在成功登录时清理，未过期会话可跨服务重启恢复。身份管理日志只记录操作者、目标 ID 和动作，不记录密码或 Cookie。

## API 与扩展

业务监听提供 `/api/v1/auth/login`、`/logout`、`/me`、`/password`，以及 `/api/v1/members/list`、`/create`、`/update`。SDK 为 `client.identity.*`，不向 JavaScript 返回会话凭证。

本地身份持久化通过可选 `StorageService.identity: IdentityStore` 接入，内存和 PostgreSQL 已实现。自定义 Storage Provider 未实现时，开启本地登录会明确失败，不会静默降级。通用业务认证接口 `AuthConfig.session / validatePrincipal` 与静态 Token 验证分离；未来接企业认证可以复用 Principal 与业务接口权限边界，无需修改 Agent 循环。本阶段不包含 SSO、自助注册、租户开通、跨租户成员切换、MFA、审批流或知识上传页面。
