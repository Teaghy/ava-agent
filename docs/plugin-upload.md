# 上传插件包

在 Ops“插件维护”连接具有 `admin:true` 与 `managePlugins:true` 的维护身份，选择 ZIP 并点击“上传并安装”。只读排障身份不能上传或启用插件。API 为独立 Ops 监听上的 `POST /api/v1/plugins/upload`，请求体为原始 ZIP 字节，Content-Type 为 `application/zip`，SDK 提供 `client.plugins.upload(blob, signal)`。

包根目录的 `ava-plugin.json` 示例：

```json
{
  "name": "订单决策",
  "version": "1.0.0",
  "entry": "dist/index.mjs",
  "kind": "provider",
  "slot": "decision"
}
```

扩展插件使用 `kind: "extension"` 并省略 slot。版本使用三段数字，可附加预发布后缀，例如 `1.0.0-beta.1`。入口是包内相对路径，支持 .js/.mjs/.cjs；不得包含绝对路径、反斜线、冒号、父目录、隐藏目录、Windows 保留名称或大小写冲突。包内路径采用字母、数字、下划线、@、点和连字符，各路径段以字母、数字、下划线或 @ 开头。入口代码应导出原生 Cordis 插件，具体插件声明在启用时校验。

上传上限 10 MiB，解压总量上限 50 MiB，最多 500 个 ZIP 条目，manifest 上限 16 KiB。不接受加密 ZIP 或符号链接。所有校验和解压由后端执行；授权检查在读取上传内容之前进行。普通 JSON 接口仍保留 64 KiB 限制。自定义 HTTP Provider 如需上传能力，应实现 `HttpRequest.bytes(maxBytes)` 并在读取中强制限制实际大小。

插件项目在外部完成构建，依赖应打包进产物或随包提供。服务器不会执行 npm 安装、构建脚本或安装钩子。包可提供 package.json；未提供时，服务器写入 `{"type":"module"}` 使 .js 默认按 ESM 加载。不要依赖开发机的绝对路径或全局 node_modules。

上传时仅解压和登记，**不会导入或执行插件代码**。安装完成显示为未启用，可先配置参数再启用。启用才执行模块导入、原生插件校验和装配；插件以 Harness 进程权限执行，无代码沙箱。

每次上传保存到插件状态文件旁的 `packages/<安装UUID>/<版本>/`。状态文件、该 packages 目录及必要运行依赖均须持久化。更新时上传新版本，旧版本保留；启用新 Provider 会停用相同槽位的旧实现，失败则尝试回退。也可在列表重新启用旧版本。上传、校验或登记保存失败时会清理本次创建的目录。

移除登记仍保留磁盘文件，避免误删还需核对的产物；本版不提供自动磁盘回收、签名验证、源码构建或插件市场。开发者的本地路径登记保留在折叠入口。

可直接打包的示例见 [examples/upload-plugin](../examples/upload-plugin/README.md)。
