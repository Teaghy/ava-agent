# 应用内插件（可选）

这里可存放与当前应用一起维护的少量插件；普通插件可以作为完全独立的项目维护，无需复制到此目录。

日常使用优先打开 Web 的“插件管理”，加载独立项目已构建的 JavaScript 入口。独立项目示例见 [local-rule-plugin](../examples/local-rule-plugin/README.md)。

需要随部署固定装配时，也可在根目录 [ava.config.ts](../ava.config.ts) 导入插件并填入 `providers` 或 `plugins`。开发启动读取 TS 配置；`pnpm build` 或 `pnpm build:plugins` 会将它和本目录的 TS 文件编译到 `.ava/`，生产启动读取 `.ava/ava.config.js`。

程序化调用 `createHarness` 的契约见 [插件开发文档](../docs/plugin-development.md)。
