# model-settings

`ModelSettingsController` 管理 OpenAI 兼容的默认 model / embedding / vector 稳定代理，以及服务端状态文件。首次读取环境配置，后续恢复同插件状态目录下的 `models.json`。Ops API 只返回连接元数据与 Key 是否存在。

`apply()` 按 revision 排队，借用 PluginManager 的维护队列取消并等待 Agent，排空知识写入，然后验证更改的模型配置；Embedding 身份变更时按 StorageService 的全局 ID 游标读取已发布分片，生成新 collection。持久化成功后同步替换三个代理。任务完成前恢复 Agent；恢复失败回退配置，并保持维护入口关闭，避免继续执行。

依赖：API 注入 `ops`、`telemetry`；controller 由 bootstrap 注入存储 getter、维护调度、Qdrant factory。live 默认 Provider 才允许更改，自定义 model、embedding、vector、rag 时禁用。服务关闭会取消连接验证/向量请求并等待任务结束。

使用及单实例限制见 [Ops 模型配置](../../../../../docs/model-settings.md)。
