# 应用 Key、会话与独立知识空间

接入系统管理自己的用户和登录。Agent 底座只验证应用 Key，确定租户、稳定应用身份、知识空间和权限，再校验会话归属；不要求同步接入方的用户账号。本地登录与个人 Token 仍可选用，Ops 始终使用独立维护凭证。

## 在线管理（推荐）

启用 `LOCAL_AUTH_ENABLED=true`，执行 `pnpm db:migrate` 并初始化租户管理员后，打开业务后台 `/admin/` 的“应用与凭证”。账号初始化见 [本地身份](local-identity.md)。只有本租户管理员可管理；普通成员、应用 Key 和 Ops Token 都不能调用这些管理接口。

1. 创建应用，填写显示名称、稳定 applicationId 和 knowledgeSpaceId。填写已有空间 ID 可与其他设备共享资料，创建应用本身不会复制知识。
2. 选择应用，签发 Key。可选择“对话与检索”“仅导入知识”或两者，并设置到期时间与额外工具权限。默认仅 READ。
3. 新 Key 只在签发响应中返回一次，页面默认掩码展示，可主动复制或显示。关闭、切换应用、离开页面或刷新后无法取回完整值；后续只能查看名称、尾号、权限、有效期和状态。数据库只保存 SHA-256 摘要。
4. 轮换时先签发新 Key，更新调用方，再撤销旧 Key。撤销不可恢复；应用停用会使全部 Key 停止接受新请求，重新启用只恢复未撤销、未到期的 Key。

以上写入即时生效，不需要重启。每次业务请求查询共享数据库，不缓存认证结果，因此多实例共用同一 PostgreSQL 时也能即时撤销。已经认证的在途执行不会被中断。应用 ID、知识空间与数据归属不可在线变更，状态修改带版本校验，409 冲突后需刷新重试。列表每页 50 条，可加载更多。

页面仅把一次性 Key 保存在组件内存，不保存到 localStorage/sessionStorage；Key 的调用权限不包含成员、应用管理或 Ops。身份与应用变更日志不包含明文 Key，Ops 轨迹也会遮盖 `ava_app_` 格式凭证。纯内存 mock 的管理状态在重启后丢失，不能用它验证持久撤销；持久部署使用 PostgreSQL。

## 环境凭证初始化与迁移

在根 `.env` 的 `APPLICATION_KEYS` 配置 JSON（一行）。Key 用密码学随机值，每个 Key 长度 32–256 字符；不要使用下面的占位值。可在自己的终端执行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 生成，并通过私密渠道交付。

```dotenv
APPLICATION_KEYS={"<replace-with-a-random-vcd86-device-a-key>":{"tenantId":"company-a","applicationId":"vcd86-device-a","knowledgeSpaceId":"vcd86"},"<replace-with-a-random-vcd86-device-b-key>":{"tenantId":"company-a","applicationId":"vcd86-device-b","knowledgeSpaceId":"vcd86"},"<replace-with-a-random-vcd55-backend-key>":{"tenantId":"company-a","applicationId":"vcd55-backend","knowledgeSpaceId":"vcd55"}}
```

| 字段             | 含义                                                        |
| ---------------- | ----------------------------------------------------------- |
| tenantId         | 所属公司，数据隔离的第一层                                  |
| applicationId    | 稳定调用方身份，可以代表一台设备或一个后台；与 Key 本身无关 |
| knowledgeSpaceId | 允许访问的唯一知识空间，可以被多个应用共用                  |
| permissions      | 工具权限，默认 `["READ"]`，可显式授权 WRITE、CRITICAL       |
| allowChat        | 是否允许对话及会话接口，默认 true                           |
| manageKnowledge  | 是否允许向绑定知识空间导入资料，默认 false                  |
| expiresAt        | 可选 UTC 过期时间，如 `2027-01-01T00:00:00Z`                |

应用 ID 和知识空间 ID 为 1–100 个字母、数字、点、下划线或连字符。Key 不接受 userId、admin、managePlugins 或 inspectRuns 等字段，不得复用个人或 Ops Token；启动时也会检查已入库的应用 Key 是否被误填为个人或 Ops 凭证，发现复用会拒绝启动。同租户同应用的所有 Key 必须绑定相同知识空间；权限和过期时间可不同。

先执行 `pnpm db:migrate`，再构建、启动。已有 `APPLICATION_KEYS` 会在启动时幂等导入应用与凭证记录，不移动原知识或会话。导入后以数据库状态为准：重启不会恢复已撤销 Key、重新启用已停用应用，或用 `.env` 覆盖权限和有效期。若环境中的知识空间或 Key 归属与已保存记录冲突，启动会明确失败，避免静默改变数据范围。

**删除 `.env` 中已导入的 Key 不会撤销数据库中的凭证，必须在后台执行撤销。** 可以在确认导入后移除环境明文，后续通过后台管理；如果仅使用已保存的有效应用凭证，生产启动也能从数据库确认认证配置，无需再次提供这些 Key 的明文。新增环境 Key 仍需重启导入，日常新增、轮换和撤销推荐使用在线管理。不要将实际 Key 提交版本库。

纯内存 mock 重启会丢失数据库状态，因此仍在 `.env` 中的 Key 会作为初始凭证重新导入；生产部署必须使用持久化存储。

多实例部署必须先升级全部实例，再启用应用 Key 和导入私库；旧版本不识别知识空间，不能与新版本混跑后继续服务同一批私库数据。回滚旧版本前也必须先隔离这些资料和访问入口。

## 会话归属与接入责任

接入方后端验证用户身份，并保存“自己的用户 → conversationId”关系。调用时只提交：

```http
POST /api/v1/chat
Authorization: Bearer <application-key>
Content-Type: application/json

{"conversationId":"a-globally-unique-conversation-id","message":"设备报 E102，如何处理？"}
```

底座仍返回 SSE：`answer.delta` 用于逐步显示，`answer.completed` 表示完整答案与引用；中断、失败不能当作成功回答。SDK 原有 `new AgentClient({ baseURL, token }).chat.stream(...)` 直接适用，无需新客户端。

会话 ID 沿用现有全局唯一约定，建议 UUID。已有 ID 属于其他应用时，聊天、历史与删除返回 403，不会覆盖。列表仅返回当前租户和应用拥有的会话。应用身份及创建时的知识空间持久化在会话上，不能通过更换 Key 或请求字段改变；修改应用的知识空间后，旧会话不能继续使用，建议新建应用和会话以保留明确边界。

同一应用里的不同用户使用不同 conversationId，上下文和摘要按会话保存。应用调用不召回以个人 userId 为维度的长期记忆，避免共享凭证导致跨会话的个人记忆混用。执行轨迹保留 applicationId 和 knowledgeSpaceId；底层审计兼容字段中的 `app:<hash>` 是稳定技术操作者标识，不是最终用户账号，也不会在 users 或本地账号表创建用户。

持有应用 Key 的后端被信任管理该应用的全部会话，所以同应用 Key 可以查看该应用会话列表、历史和执行删除。接入方必须在自己的后端再次校验用户与会话归属，不能盲目转发浏览器给出的会话 ID。服务级 Key 不交给终端用户浏览器；设备直连时应给每台设备分配独立 applicationId 和 Key，同一台设备多人使用时由设备决定何时新建或清除会话。请求不能传 userId、tenantId、applicationId、knowledgeSpaceId 或权限来改变身份。

## 知识空间与导入

设备 A、B 的 applicationId 不同，可以共用 vcd86 知识空间；知识共享不意味着会话共享。VCD 5.5 使用另一个空间。当前一个应用只绑定一个空间，不自动包含其他空间或公共库。

普通设备 Key 默认只读。需要导入时，为同一应用另设 `manageKnowledge:true`、`allowChat:false` 的导入凭证，或由租户管理员执行导入。SDK `client.knowledge.ingest()` 和原 `/api/v1/knowledge` 保持可用：

```json
{
  "id": "manual-v1",
  "title": "VCD 8.6 手册",
  "content": "# E102\n\n经审核的排查步骤。",
  "metadata": { "model": "VCD", "version": "8.6" }
}
```

使用应用导入凭证时，后端自动填充绑定的 knowledgeSpaceId。请求显式指定其他空间会被拒绝。租户管理员或知识维护人员可以在文档顶层指定 `knowledgeSpaceId`，选择本租户的目标空间。不同空间可使用相同文档 ID，版本不可变规则在各空间独立执行；更新内容仍需新版本 ID。

向量和 SQL 关键词检索都在候选生成前限制 tenantId + knowledgeSpaceId，SQL 发布检查也按空间执行。知识源注册边界、RAG 重排后以及内置检索工具返回前再次检查范围；模型可选择查询和 metadata 条件，不能扩大空间。默认内置 Guard 继续用已取回的分片验证引用。

未指定 knowledgeSpaceId 的原有资料归属原默认空间，旧个人 Token 和本地账号的聊天继续只检索该空间；它们不会自动读到新建的私库。应用也不会读到默认空间。迁移现有资料时需要明确将资料导入目标空间，不会自动移动或重写旧资料。索引重建会保留各分片空间标识和稳定 ID。

自定义知识源需接收 RagRequest.knowledgeSpaceId，并在返回分片中保留知识空间字段；自定义 Vector/Storage Provider 需实现新增的可选空间参数。Storage 必须实现应用会话所有权与文档空间分区，声明 `applicationScopes:true` 并提供 `applications:ApplicationStore`，才能使用持久凭证与在线管理。未实现时导入环境凭证会拒绝启动，管理接口返回明确错误。返回错误空间的检索结果会被拒绝。插件是可信进程内扩展，业务工具必须遵守 ToolContext.principal 的应用与租户范围，不能通过全局查询绕过权限。

## 轮换与撤销

在管理页面签发新 Key，指向相同 tenantId + applicationId + knowledgeSpaceId，新旧 Key 可立即并行使用；接入方切换后点击撤销旧 Key，无需重启。知识和会话绑定稳定身份，不绑定密钥，因此不会因轮换复制或丢失。到期 Key 在每次请求认证时拒绝，撤销会在下次请求时生效；已认证的在途执行不会被中途撤销。

对话限流沿用每应用每分钟 30 次，新旧 Key 共用额度，不会因为轮换而绕过限流。应用级模型、提示词和工具名称白名单不在本阶段，模型与插件仍由部署配置和 Ops 管理。

SDK 新增 `client.applications.list/create/update/keys/issueKey/revokeKey`；管理接口为业务监听上的 `/api/v1/applications/list`、`/create`、`/update` 和 `/keys/list`、`/keys/issue`、`/keys/revoke`，均使用 POST，后端校验租户管理员。Cookie 请求执行原有同源校验，所有响应 no-store。`issueKey` 是唯一返回新生成明文 Key 的接口。
