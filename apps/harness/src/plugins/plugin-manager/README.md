# plugin-manager

将独立本地 JavaScript 项目加载为原生 Cordis 插件，供维护人员使用。使用方式见 [Harness Ops 插件维护](../../../../../docs/plugin-management.md)。

- `loader.ts`：校验绝对 JS 文件路径、限制导入等待、检查原生插件与保留服务声明。使用 Node 原有模块缓存，不提供源码 HMR。
- `state.ts`：校验登记文件，成功配置通过临时文件 + rename 原子写入。
- `runtime.ts`：持有原生安装句柄和原 Provider 安装函数，装配、释放、回退并检查实际 fiber 状态；不调度 Cordis 依赖图。
- `inventory.ts`：提供内置模块的展示说明和 Cordis 状态映射。运行清单由 runtime 遍历实际注册的 fiber 构建，只读暴露模块名、来源、状态、已提供服务、声明依赖和父模块 ID，不读取配置与异常内容。应用装配根实例及后代标记为 application；外部托管插件及后代仍由外部安装列表管理，不混入内置清单。
- `manager.ts`：串行处理登记、配置、启停和移除，暂停并等待 Agent，成功后持久化，失败尝试恢复；终止状态拒绝排队的后续写操作。
- `deadline.ts`：限制控制层等待。无法强制终止同进程代码；释放/恢复超时保持执行门禁关闭并要求重启。
- `index.ts`：只依赖独立 `ops` HTTP 服务，由内置 `ops-console` 装配，不挂载到公开聊天 HTTP；读取与写入均校验独立维护凭证的 `admin && managePlugins`。切换决策时管理路由仍可用。

`createHarness` 返回 `pluginManager`，程序化场景默认不启用持久管理；CLI bootstrap 使用 `PLUGIN_STATE_PATH` / `PLUGIN_SAFE_MODE` 配置。接口响应不包含插件参数，原生 `Config` 校验继续由 Cordis 执行。

快照中的 `providers[].status` 表示实际装配状态；`runtimePlugins` 为当前内置与应用运行清单，实例 ID 只在当前进程中有效，不接受配置、停用或移除操作。旧服务端缺少该字段时 SDK 默认空数组。所有读取继续要求独立 Ops Token 的 `admin && managePlugins` 权限。

测试见 `tests/plugin-manager.test.ts`，覆盖权限、导入前授权、原生参数、生命周期、Provider 恢复、持久化失败回退、超时恢复门禁、排队拒绝、失效重试和 safe mode。

上传接口 `/api/v1/plugins/upload` 只接受维护身份的 ZIP 原始字节。`package.ts` 使用 yauzl 有界解压，校验 manifest 与路径；manager 在同一串行队列中解压、登记并持久化，失败清理本次目录。上传不执行模块，默认未启用；版本保留在状态文件旁的 packages 目录。详见 [插件包上传](../../../../../docs/plugin-upload.md)。
