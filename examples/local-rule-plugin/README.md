# 独立本地插件项目

这个目录是完整的独立插件项目示例，拥有自己的 package.json、依赖、TypeScript 配置与构建产物。Harness 加载 `dist/index.js`，不会读取、修改或构建插件源码。

在当前仓库演示：

```bash
pnpm --filter @ava/example-local-rule-plugin... build
```

打开 Web 的“插件管理”，输入此项目 `dist/index.js` 在服务端的绝对路径，选择“Provider / 决策”，参数可填：

```json
{ "question": "请提供你的订单编号。" }
```

启用后聊天会由该规则决策返回追问；停用后恢复原来的决策 Provider。配置由 Cordis 的 `Config` schema 校验。

## 移到独立仓库

1. 将本目录复制到自己的项目目录。
2. 当前 `@ava/harness` 尚未发布 npm，把 package.json 中的开发依赖 `"@ava/harness": "workspace:*"` 改为指向本机 Harness 包的 link，例如 `"link:F:/ai-company/ava-agent/apps/harness"`。Harness 必须先构建，以提供声明文件。
3. 在独立项目执行 `pnpm install`、`pnpm build`。
4. 在管理页填写独立项目构建入口的绝对路径；该路径必须能被 Harness 所在服务器访问。

插件在自己的项目内安装运行依赖（本例为 Zod）。公共接口主要用于开发时类型检查，运行时仍使用 Harness 传入的 Cordis Context。不要再创建一份 Context 来发布服务。

修改源码并重建后，需要重启 Harness 进程以重新加载 ESM 模块；本版启停与配置管理不提供源码热更新。此示例只展示无模型规则决策，不执行业务写操作。
