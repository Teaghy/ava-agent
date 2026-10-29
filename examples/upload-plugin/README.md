# 上传插件示例

该目录已经包含可运行的 JS 入口和 ava-plugin.json，无需编译或安装依赖。示例替换 Decision Provider；启用后会向用户询问订单号。

从仓库根目录使用 PowerShell 打包：

```powershell
Compress-Archive -LiteralPath examples/upload-plugin/ava-plugin.json,examples/upload-plugin/index.mjs -DestinationPath upload-plugin.zip
```

ZIP 根目录必须直接包含 ava-plugin.json，不能额外套一层目录。在 Ops 连接具有插件管理权限的身份，选择 ZIP 并点击“上传并安装”。插件初始未启用，可以先设置完整参数 `{"question":"请提供设备序列号。"}`，再启用。

更新时修改 manifest 的 version、重新打包上传，确认后启用新版本；旧版本文件和登记仍保留。新 Provider 成功启用会停用相同槽位的旧 Provider。若新版本启用失败，现有生命周期会尝试恢复先前装配。需要回到旧版本时在列表启用旧版本即可。
