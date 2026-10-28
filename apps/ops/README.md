# Harness Ops

仅供平台维护人员使用的独立 React 插件维护界面，不属于客户聊天端或业务管理端。通过同源 `@ava/sdk` 调用维护 API，Token 仅存页面内存。

`pnpm dev` 构建并监听本应用，访问 Harness 的维护端口；`pnpm build:harness` / `pnpm build` 将产物复制进 `apps/harness/dist/ops`，无需独立部署。本地单独构建使用 `pnpm --filter @ava/ops... build`。

配置 `OPS_ENABLED=true`、独立的 `OPS_API_KEYS` 并重启 Harness 后，默认访问 `http://127.0.0.1:3001/`。完整入口隔离、凭证和故障恢复见 [维护文档](../../docs/plugin-management.md)。
