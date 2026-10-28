# Web 插件管理

插件独立成项目维护、安装依赖并构建，Harness 只加载其 JavaScript 入口。第一版支持服务端本地的 `.js`、`.mjs`、`.cjs` 文件，不下载 npm，不接收源码上传，不代运行构建脚本。

## 从哪里进入

运行 `pnpm dev`，打开聊天页面，点击左侧“插件管理”；也可以访问 `http://127.0.0.1:3000/#/plugins`（端口随服务配置）。管理页支持登记、参数配置、启用、停用、移除，以及查看当前 Provider。

日常 CLI 启动默认启用持久管理。直接调用 `createHarness` 默认不开启磁盘管理，需要显式传入 `pluginManagement: { statePath }`；设为 `false` 可关闭管理。根目录 `ava.config.ts` 继续用于固定装配，开发启动读取 TS，生产启动读取构建后的 `.ava/ava.config.js`。

## 配置平台管理权限

在根 `.env` 中的 `API_KEYS` 为平台管理员配置一个 Token。下面的键是占位示例，部署时替换为自己生成的长随机值：

```dotenv
API_KEYS={"replace-with-your-random-platform-token":{"tenantId":"demo","userId":"operator","permissions":["READ","WRITE"],"admin":true,"managePlugins":true}}
```

修改后重启服务，在管理页输入该 Token。只有同时具有 `admin: true` 和 `managePlugins: true` 的身份能管理进程插件。普通知识库管理员、匿名演示身份都不能加载代码。Token 只保存在页面内存中，离开管理页后清除。

## 加载自己的插件

1. 在插件项目中自行执行构建，确认运行依赖已经安装。
2. 在管理页填写名称与构建入口的绝对路径，例如 `F:/my-plugins/order-rules/dist/index.js`。
3. 选择“扩展插件”或“算法 Provider”。Provider 还要选择其服务槽位。
4. 可填写插件参数，必须为 JSON 对象；它直接传给原生 Cordis 插件的 `Config` / `apply`。
5. 点击“登记插件”。默认立即启用，也可以只登记、稍后启用。

路径指向 **Harness 所在服务器** 的文件。浏览器与服务器不在同一台电脑时，填写服务器上的路径。插件可在任何独立仓库中开发，不必复制进 Harness 的 `src/plugins` 或 `extensions`。

### 插件导出约定

支持默认导出一个原生 Cordis 插件，也支持命名导出 `name`、`provide`、`inject`、`Config`、`apply` 的模块。仍由 Cordis 校验参数、解析依赖、执行生命周期和释放 effects，不需要新的插件 manifest。

完整独立项目示例见 [local-rule-plugin](../examples/local-rule-plugin/README.md)。在本仓库执行：

```bash
pnpm --filter @ava/example-local-rule-plugin... build
```

然后在页面填写该项目 `dist/index.js` 的绝对路径，选择“算法 Provider / 决策”，参数填：

```json
{ "question": "请提供订单编号，我来继续处理。" }
```

启用后通过聊天页面提问，会收到插件配置的追问；停用后恢复原来选择的决策实现。示例可复制到独立目录，按其 README 链接 Harness 的开发类型包。

## 扩展与替换

| 类型          | 行为                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 扩展插件      | 追加工具、知识源、行业校验或自己的新服务；不能覆盖底座保留服务                                           |
| 算法 Provider | 替换 `decision`、`model`、`embedding`、`reranker`、`memory`、`rag` 中一个槽位；必须通过 `provide` 声明它 |

同一槽位只运行一个管理插件。启用另一个 Provider 会停用该槽位原来的管理插件；停用当前 Provider 后恢复 `ava.config.ts` 选择的实现或内置默认实现，不会自动启用历史插件。

基础设施、鉴权、基础 Guard、HTTP 和 Runtime 不开放页面在线替换。决策输出仍经过 schema、工具权限、预算、引用和行业校验。算法输入是快照，不能通过修改输入改写底座权威状态。

## 配置、启停与状态

- 点击已登记插件的“配置”，填写 **完整替换参数**。为避免凭据泄漏，原参数不会回传或预填。活跃插件重新装配并校验，停用插件只保存参数，在下次启用时校验。
- 插件变更串行执行。变更前取消并等待当前 Agent 任务，期间新聊天返回 `PLUGIN_CHANGE_IN_PROGRESS`；成功后恢复运行。
- 新实现激活失败或配置写入失败时，尝试恢复旧的原生插件装配和参数。失败的变更不会写入登记文件。
- 状态依据 Cordis 的实际 fiber，不只依据“是否希望启用”。运行中、已停用和失效状态分别显示；依赖失效或插件自行卸载后可显式重试。
- “移除”删除登记与保存参数，保留插件项目和 JS 文件。

插件是受信任的进程代码，不是沙箱。第三方业务副作用不能由装配回退撤销；外部调用应处理 `AbortSignal`、设置超时，并用 `ctx.effect` 注册释放函数。

若初始化、取消或释放不响应，管理层会限制等待、返回恢复错误，并保持执行门禁关闭。此时需要重启服务；无法强制终止同一进程中的任意代码，优雅停止也可能等待插件清理。不会声称回退成功后继续提供不完整的客服服务。

修改插件源码并重建后，重启 Harness 以重新加载 Node ESM 模块；页面启停和参数变更不提供源码热更新。

## 持久化与故障恢复

默认登记文件为项目根目录 `data/plugins.json`，成功变更以临时文件 + rename 写入。该文件可能含插件凭据，接口不会返回其中的参数；应随服务数据目录持久保管，不提交版本库。

```dotenv
PLUGIN_STATE_PATH=data/plugins.json
PLUGIN_SAFE_MODE=false
```

重启时恢复保存的启用状态。插件路径、导入或激活出错会明确阻止正常启动。需要跳过坏插件恢复管理界面时，临时设 `PLUGIN_SAFE_MODE=true` 并重启；管理页仍列出登记信息，可逐个启用、停用或移除。修复完成后关闭 safe mode，再重启。

safe mode 跳过自动激活，不静默修改保存的启用偏好；页面按实际状态提供“启用”。如果登记 JSON 本身损坏，需要先修复文件；safe mode 不会忽略损坏的配置文件。原应用默认 Provider 仍需满足自身凭据和基础设施要求。

## API / SDK

管理接口都要求平台权限：

- `GET /api/v1/plugins`
- `POST /api/v1/plugins/install`
- `POST /api/v1/plugins/action`：`{ id, action: "enable" | "disable" | "remove" }`
- `POST /api/v1/plugins/configure`：`{ id, config }`

对应 SDK 为 `client.plugins.list/install/action/configure`，支持 AbortSignal。返回快照不包含已保存的插件参数。
