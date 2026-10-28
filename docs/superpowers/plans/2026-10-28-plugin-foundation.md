# 客服插件扩展入口实施计划

**Goal:** 保留默认可运行的客服流程，让行业接入通过公开入口替换算法、注册知识源和工具、追加校验，无需修改 bootstrap 或 Runtime。

**Architecture:** 继续使用 Cordis 的原生插件、inject/provide 和 effect。createHarness 增加明确的 Provider 槽位与扩展插件数组；Runtime 只接收领域依赖。Guard 的基础校验保留，并允许注册异步行业校验。开发者通过 @ava/harness 与 @ava/harness/plugin 子路径接入。

**Tech Stack:** TypeScript、Cordis 4.0.0-rc.12、Zod、Vitest、pnpm、oxlint/oxfmt。

这是上一轮讨论已授权的架构打磨范围，在当前干净工作区实施；不创建插件市场、动态配置 Loader 或第二套 DI，不自动提交。

## 1. 明确装配入口

- [x] 先写行为测试：自定义 Decision 替换默认实现，扩展插件按依赖激活和释放，Provider 冲突与错误声明启动时报错，失败装配释放资源。
- [x] 提供 HarnessOptions：providers（model/decision/embedding/reranker/memory/rag/storage/cache/vector）、plugins、systemPrompt、demoTools、startupTimeoutMs。规则决策可显式关闭 model，默认凭据校验服从实际装配。
- [x] 使用原生无参 Cordis 插件；插件配置由工厂函数校验并绑定，内置 Provider 保留原生插件参数。
- [x] Provider 通过 provide 声明对应槽位；扩展插件不能暗中覆盖底座服务。保留 Cordis 作为唯一依赖调度器，启动等待设上限并提供诊断。
- [x] mock 默认启用演示工具，live 禁止；行业示例可在 mock 中关闭。默认提示词使用通用客服措辞。

## 2. 固定运行与校验边界

- [x] 先写行为测试：Guard 缺失时不生成答案；异步行业校验阻断输出且随插件卸载；自定义检索工具遵守检索预算；停止时取消运行并等待释放锁。
- [x] 添加 AgentDependencies；Runtime 不依赖 Cordis Context，插件入口负责注入。
- [x] Guard 成为强依赖，支持具名、可释放的追加策略，等待异步校验；模拟工单规则移到模拟业务插件。
- [x] Tool 增加 retrieval 分类并写入轨迹，检索预算和证据判断不依赖内置工具名称。
- [x] Agent 提供停止入口，生命周期取消与等待正在执行的任务；Harness 在卸载基础设施前停止请求和 Runtime。

## 3. 公开开发契约与实际例子

- [x] 添加 @ava/harness 和 @ava/harness/plugin exports，生成声明文件，禁止插件依赖私有源码路径。
- [x] 添加独立行业示例包：规则决策 + 自定义知识源 + 带对象级授权的业务工具 + 追加策略，使用公开入口运行。
- [x] 测试示例真实执行路径与权限失败路径，保留原默认客服回归测试。
- [x] 编写插件开发文档：替换/追加区别、配置工厂、生命周期、启动失败、信任边界和兼容范围。
- [x] 更新 README、架构说明和受影响插件文档。

## 验收

- [x] 基线 pnpm test：47 个测试通过。
- [x] 新行为测试先失败，再修复为通过。
- [x] pnpm lint、pnpm format:check、pnpm typecheck、pnpm test、pnpm build。
- [x] 使用构建后的公开入口运行行业示例，验证输出、引用和资源释放。
- [x] 审查 git diff，报告本轮变更与尚未处理的事务一致性、幂等续跑限制。

## 验收记录

- 原有 47 个测试与新增 31 个测试共 78 个通过。
- lint、类型检查、构建、格式检查通过，独立零售示例执行成功。
- 只读审查发现的未发布 Provider 问题已补回归测试并修复，复查无阻断问题。
- Windows Git autocrlf 与 formatter 换行不一致已通过 .gitattributes 统一为 LF；未修改无关文件的 Git 内容。
- 未运行真实 PostgreSQL/Redis/Qdrant 集成环境；未改写存储协议或数据库迁移。事务检查点与幂等续跑保持文档列明的后续范围。
