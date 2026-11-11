# 本地持久化部署

适合单进程、小规模本机使用：模型和 Embedding 使用 `.env` 中的真实服务，缓存保留在内存；会话、摘要、运行轨迹、知识分片、账号和应用凭证保存到 `data/local/storage.bin`，向量保存到 `data/local/vectors.bin`。

在根 `.env` 设置 `APP_MODE=live`、`AVA_CONFIG=examples/local-file/ava.config.mjs`，配置模型和访问凭据，然后运行 `pnpm build && pnpm start`。无需 PostgreSQL、Redis 或 Qdrant。相对数据路径基于仓库根目录，不受启动目录影响。

数据采用带版本号的二进制快照，每次写操作成功前原子保存；保存失败会回退本次内存修改，损坏的文件会阻止启动。文件权限为 `0600`。数据包含私人会话和凭据哈希，请持久保存并备份整个 `data/local` 目录。仅支持一个进程使用同一份数据文件，不适合多实例或大量数据；此时使用默认 PostgreSQL + Redis + Qdrant 部署。

Ops 的“模型配置”可在线更换默认 LLM 和 Embedding 的地址、模型、Key、维度与批次大小，配置保存在 `data/models.json`。更换 Embedding 地址、模型或维度时，会以新模型重建所有租户已发布的知识，写入独立的 `vectors.bin.<collection>.<dimensions>.bin` 文件；全部写入成功并保存配置后，才一起切换查询模型和索引。仅修改 Key 或批次大小不会重建。验证、重建或配置保存失败时继续使用原模型和索引，会话与知识原文保留。

原有 `vectors.bin` 自动作为初始 collection 读取，已有数据无需重新导入。新装配通过 `vectorStore: createFileVectorStore(...)` 将索引创建与生命周期交给模型设置控制器管理；原始的自定义 `providers.vector` 不具备这一能力，仍禁止在线更换 Embedding。旧索引与失败任务的索引保留用于回退，确认不再使用后可清理；备份时保留整个 `data/local` 和 `data/models.json`，使配置与索引成对恢复。

纯内存 Provider 仍用于测试和临时演示；原来已经随进程退出的内存数据无法恢复。迁移仍在运行的内存实例时，必须在停止进程前导出会话与向量数据。
