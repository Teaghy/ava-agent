# 可视化本地插件管理实施计划

**Goal:** 用户在 Web 中加载独立本地项目构建的 JS，配置、启停扩展和切换算法 Provider；Harness 不接管插件源码或构建。

**Architecture:** 保留 Cordis 为唯一生命周期内核。平台管理员通过 HTTP/SDK 操作一个串行配置控制器；调用原生 ctx.plugin(plugin, config)，复用默认 Provider 安装函数用于回退。切换前暂停并取消/等待 Agent，成功后恢复；失败回退原有装配。成功变更原子写入 JSON，重启恢复；损坏插件可用显式 safe mode 跳过恢复。默认 CLI 启用持久管理，程序化 createHarness 可显式启用或关闭。Web 使用 #/plugins，避免额外路由依赖。

**User choice:** 首版只接受本地已构建的 .js/.mjs/.cjs 文件入口；不下载 npm，不上传源码，不运行构建脚本。算法切换支持 decision/model/embedding/reranker/memory/rag；基础设施与基础 Guard 不开放在线替换。

## Tasks

1. 共享协议与 SDK（主代理）：固定下面的 HTTP 契约、Zod 校验和客户端 methods。
2. 服务端（实现代理）：本地模块加载、配置持久化、启停/回退、维护期间执行门禁、管理员 API、bootstrap 恢复、行为测试。
3. Web（实现代理）：可达的插件页、平台 Token、注册表单、状态、启停移除、Provider 当前来源，沿用现有样式。
4. 集成与复查（主代理 + 只读审查）：独立插件示例、文档、真实 HTTP/浏览器验证、测试/构建/lint/格式检查。

## HTTP / SDK contract

- GET /api/v1/plugins -> PluginManagerSnapshot。
- POST /api/v1/plugins/install，body PluginInstallRequest -> PluginManagerSnapshot。
- POST /api/v1/plugins/action，body { id, action: enable|disable|remove } -> PluginManagerSnapshot。
- POST /api/v1/plugins/configure，body { id, config } -> PluginManagerSnapshot；完整替换参数，原配置不回传。
- AgentClient.plugins.list(signal?), .install(input, signal?), .action(input, signal?)。
- PluginInstallRequest: { name, entry, kind: extension|provider, slot?: decision|model|embedding|reranker|memory|rag, config?: Record<string, unknown>, enabled?: boolean(default true) }。Provider 必须有 slot，extension 不能有 slot。
- Snapshot: { enabled: boolean, safeMode: boolean, plugins: PluginView[], providers: ProviderView[] }。
- PluginView: { id(uuid), name, entry, kind, slot?, enabled, status: active|disabled|failed, error? }，不返回保存的 config（可能含凭据）。
- ProviderView: { slot, source: default|application|plugin, name, pluginId? }。
- 权限：有效 Token，同时 admin:true 与 managePlugins:true；租户知识管理员不能获得进程代码加载权限。匿名开发身份无权限。

## Execution notes

- 当前 checkout 的既有修改为此前已授权工作，继续在原工作区集成，不提交、不重置。
- provider 切换时旧实现被释放；失败需重新安装原有安装函数并恢复 Agent。不承诺第三方业务副作用可回滚。
- 本地插件是受信任进程代码。启停/配置不等于 ESM 源码热更新；修改构建产物后重启进程。
- safe mode 是显式运维恢复，不自动静默退回默认决策。
- 旧的根配置入口继续保留，用于部署与恢复；Web 管理使用独立持久文件。

## Coordination ledger

| Tasks | Shared interface / files      | Resolution                                     |
| ----- | ----------------------------- | ---------------------------------------------- |
| 1 / 2 | packages/protocol plugins DTO | 主代理先写契约，服务端消费；服务端不修改协议   |
| 1 / 3 | SDK plugins methods           | 主代理实现；Web 消费，不直接依赖 Harness       |
| 2 / 3 | API paths and error behavior  | 固定上面的契约；前端显示服务器返回的错误       |
| 2 / 4 | apps/harness bootstrap/config | 服务端代理独占此范围，主代理只处理根配置/文档  |
| 3 / 4 | apps/web sources/styles       | Web 代理独占，主代理做最终集成验证             |
| 1     | DTO, schema, methods          | 一致；输出不包含插件 config                    |
| 2     | Runtime updates and disk      | 先完成原生装配，再写成功配置；磁盘失败亦需回退 |
| 3     | UX and permissions            | 页面可达；错误状态可读，Token 仅保存在内存     |

- [x] 共享协议/SDK
- [x] 服务端管理与测试
- [x] Web 管理页
- [x] 文档、集成验证与复查

## 验收记录

- `pnpm test`：105 个测试通过，包含 15 个真实 HTTP/临时模块的管理测试、9 个应用配置入口测试与 SDK 契约测试。
- Web 真实页面已验证登记、参数编辑和切换决策；聊天收到独立插件的新配置追问。截图保存在 `.ava/plugin-management-verified.jpg`。
- Web 审查中的 safe mode 启用按钮已修复。服务端审查中的初始化/释放超时、失效状态与排队越过终止状态均有回归测试并已复查通过。
- 插件项目源码仍由独立项目维护，提供 `examples/local-rule-plugin` 作为完整项目示例；未引入 npm 下载、源码构建或第二套 DI。
- 未提交或暂存改动。真实外部基础设施联调、源码 HMR、第三方业务副作用回滚仍在本轮范围之外。
