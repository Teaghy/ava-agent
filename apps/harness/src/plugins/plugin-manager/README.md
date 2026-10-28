# plugin-manager

将独立本地 JavaScript 项目加载为原生 Cordis 插件，供维护人员使用。使用方式见 [Harness Ops 插件维护](../../../../../docs/plugin-management.md)。

- `loader.ts`：校验绝对 JS 文件路径、限制导入等待、检查原生插件与保留服务声明。使用 Node 原有模块缓存，不提供源码 HMR。
- `state.ts`：校验登记文件，成功配置通过临时文件 + rename 原子写入。
- `runtime.ts`：持有原生安装句柄和原 Provider 安装函数，装配、释放、回退并检查实际 fiber 状态；不调度 Cordis 依赖图。
- `manager.ts`：串行处理登记、配置、启停和移除，暂停并等待 Agent，成功后持久化，失败尝试恢复；终止状态拒绝排队的后续写操作。
- `deadline.ts`：限制控制层等待。无法强制终止同进程代码；释放/恢复超时保持执行门禁关闭并要求重启。
- `index.ts`：只依赖独立 `ops` HTTP 服务，由内置 `ops-console` 装配，不挂载到公开聊天 HTTP；读取与写入均校验独立维护凭证的 `admin && managePlugins`。切换决策时管理路由仍可用。

`createHarness` 返回 `pluginManager`，程序化场景默认不启用持久管理；CLI bootstrap 使用 `PLUGIN_STATE_PATH` / `PLUGIN_SAFE_MODE` 配置。接口响应不包含插件参数，原生 `Config` 校验继续由 Cordis 执行。

测试见 `tests/plugin-manager.test.ts`，覆盖权限、导入前授权、原生参数、生命周期、Provider 恢复、持久化失败回退、超时恢复门禁、排队拒绝、失效重试和 safe mode。
