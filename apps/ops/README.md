# Harness Ops

仅供平台维护人员使用的独立 React 维护界面，提供插件维护、运行排查与模型配置。通过同源 `@ava/sdk` 调用维护 API，登录 Token 存在当前标签页的 sessionStorage，刷新后重新验证并恢复连接。

`pnpm dev` 构建并监听本应用，访问 Harness 的维护端口；`pnpm build:harness` / `pnpm build` 将产物复制进 `apps/harness/dist/ops`，无需独立部署。本地单独构建使用 `pnpm --filter @ava/ops... build`。

配置 `OPS_ENABLED=true`、独立的 `OPS_API_KEYS` 并重启 Harness 后，默认访问 `http://127.0.0.1:3001/`。完整入口隔离、凭证和故障恢复见 [维护文档](../../docs/plugin-management.md)。

运行排查入口为 `/#runs`：按租户、运行状态、runId、会话及时间筛选，分页浏览运行；选择记录后查看按事件顺序连接的轨迹节点、工具参数与结果、检索资料及错误。新记录包含决策、工具和答案校验耗时，旧记录仍可查看已有事件。页面手动刷新，不自动重放工具。

运行详情保留默认“事件轨迹”，并提供可切换的“轨迹图”。新增视图参考 [DSH 的轨迹模块](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/ui-trajectory/src/client)：顶部按输入与上下文、模型、工具与检索显示三泳道概览，下方按执行步骤排列三列记录。支持事件顺序 / 记录耗时切换、概览缩放、点击定位、关键词搜索、步骤折叠，以及共用的状态快照开关。两种视图共用同一份脱敏后的运行事件和当前节点选择，不发起业务调用。

相邻的决策耗时事件合并到对应决策，避免重复计数；其他事件保留原顺序和 ID。耗时区间由事件时间与已记录的 `durationMs` 回推；缺少耗时的旧事件以时间点展示，不把相邻事件间隔当作操作耗时。正文生成记录可显示已记录的首字耗时；失败和部分输出信息仍取自原始事件。缺少有效时间的记录保留在表格中，空记录也可查看。现有数据没有子 Agent 或并行调用关联，因此不推断额外分支、父子关系或 token 用量。

窄屏下表格和放大的概览在各自容器内滚动；原事件轨迹继续使用原有布局。`pnpm --filter @ava/ops test` 验证轨迹投影中的耗时合并、失败定位、旧数据兼容和事件顺序。

运行排查要求 `inspectRuns:true`，插件维护要求 `admin && managePlugins`，两者独立授权。仅有排查权限也能登录 Ops；导航按权限展示。排查默认只查身份所属租户。跨租户通过 `OPS_API_KEYS` 中的 `inspectTenants: ["demo", "other-tenant"]` 显式授权。列表和详情只挂载于独立 Ops 监听，查询记录到结构化日志。响应过滤常见凭据字段、已配置密钥和隐藏推理字段；业务内容仍属于敏感排障数据，仅授权维护人员可见。

使用 PostgreSQL 时运行 `pnpm db:migrate` 应用运行列表索引。自定义 StorageService Provider 需实现 `listRuns(query)`，查询必须按 tenantId 过滤、按创建时间及 runId 倒序、应用 limit/offset，只返回运行摘要。

插件维护默认支持上传 ZIP 安装，初始未启用；本地路径登记位于开发者折叠入口。包格式、限制与版本恢复见 [插件包上传](../../docs/plugin-upload.md)。

插件页分三部分：当前能力提供方展示七个可替换服务的实际实现、来源与装配状态；内置与应用插件以分组卡片展示当前 Cordis 实例，可按名称、说明、服务和依赖搜索，展开查看职责与接口；外部安装插件继续提供配置、启停与移除操作。内置清单只读，服务与依赖来自实际运行实例，不返回插件参数或凭据。未装配的实现不计入清单；应用 Provider / 扩展单独标注，外部托管插件不会重复混入内置列表。页面手动刷新状态，“运行中”表示插件已激活，不代表外部模型连接健康。

卡片、分组与展开详情的交互参考 [DeepSeek Harness 插件清单源码](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447/packages/client/ui-settings-plugin-inventory)，沿用本项目样式变量和维护权限。

模型配置入口为 `/#models`，要求 `admin && managePlugins`。live 默认 Provider 支持更改 LLM / Embedding 的 Base URL、名称与 Key 并热应用；Embedding 地址、模型或维度更改后自动重建知识索引。Key 不回显、不保存在浏览器，留空保留已有值。详见 [模型配置](../../docs/model-settings.md)。
