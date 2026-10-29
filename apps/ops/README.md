# Harness Ops

仅供平台维护人员使用的独立 React 维护界面，提供插件维护与运行排查。通过同源 `@ava/sdk` 调用维护 API，Token 仅存页面内存。

`pnpm dev` 构建并监听本应用，访问 Harness 的维护端口；`pnpm build:harness` / `pnpm build` 将产物复制进 `apps/harness/dist/ops`，无需独立部署。本地单独构建使用 `pnpm --filter @ava/ops... build`。

配置 `OPS_ENABLED=true`、独立的 `OPS_API_KEYS` 并重启 Harness 后，默认访问 `http://127.0.0.1:3001/`。完整入口隔离、凭证和故障恢复见 [维护文档](../../docs/plugin-management.md)。

运行排查入口为 `/#runs`：按租户、运行状态、runId、会话及时间筛选，分页浏览运行；选择记录后查看按事件顺序连接的轨迹节点、工具参数与结果、检索资料及错误。新记录包含决策、工具和答案校验耗时，旧记录仍可查看已有事件。页面手动刷新，不自动重放工具。

运行排查要求 `inspectRuns:true`，插件维护要求 `admin && managePlugins`，两者独立授权。仅有排查权限也能登录 Ops；导航按权限展示。排查默认只查身份所属租户。跨租户通过 `OPS_API_KEYS` 中的 `inspectTenants: ["demo", "other-tenant"]` 显式授权。列表和详情只挂载于独立 Ops 监听，查询记录到结构化日志。响应过滤常见凭据字段、已配置密钥和隐藏推理字段；业务内容仍属于敏感排障数据，仅授权维护人员可见。

使用 PostgreSQL 时运行 `pnpm db:migrate` 应用运行列表索引。自定义 StorageService Provider 需实现 `listRuns(query)`，查询必须按 tenantId 过滤、按创建时间及 runId 倒序、应用 limit/offset，只返回运行摘要。

插件维护默认支持上传 ZIP 安装，初始未启用；本地路径登记位于开发者折叠入口。包格式、限制与版本恢复见 [插件包上传](../../docs/plugin-upload.md)。
