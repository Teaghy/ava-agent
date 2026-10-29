# 应用预设与回答策略

Harness 默认仍启动客服流程，也可以选择知识问答或通用聊天。预设决定默认提示词、内置工具和回答证据要求；身份、权限、审计、调用预算、引用真实性和行业策略始终由底座校验。

## 选择预设

根 `.env` 配置后重启：

```dotenv
APP_PRESET=chat
```

| 预设               | 默认行为             | 内置工具                          | 最终答案要求                                   |
| ------------------ | -------------------- | --------------------------------- | ---------------------------------------------- |
| `customer-service` | 客服问答和业务处理   | 知识检索；mock 下追加模拟业务工具 | 检索文档或成功的非检索工具结果                 |
| `knowledge`        | 根据知识库文档回答   | 知识检索                          | 本次检索文档与引用，普通工具结果不能替代文档   |
| `chat`             | 通用问答、解释和写作 | 不装配内置检索或模拟业务工具      | 可直接回答，无需先检索；提供引用时仍检查真实性 |

内置三种回答策略在使用检索文档回答时都要求引用。追问可以没有知识证据，但仍执行行业校验。只有客服预设在 `SEED_KNOWLEDGE=true` 时导入虚构设备演示知识，另外两个预设不自动导入演示资料。知识问答需要维护人员通过现有知识 API 导入实际资料；本次没有增加文档管理后台。

`APP_PRESET` 与 `APP_MODE=mock/live` 独立。mock 自由聊天返回明确标注的模拟回复，只用于验证流程；真实模型质量需要 live 验证。本次预设不改变数据库、缓存、向量与记忆等基础设施的装配，live 仍需要当前配置要求的基础设施和默认 Provider 凭据，不会静默降级到 mock。

程序化调用或 `ava.config.ts` 也可指定：

```ts
import type { HarnessOptions } from '@ava/harness';

export default {
  preset: 'knowledge',
  providers: {},
  plugins: [],
} satisfies HarnessOptions;
```

`options.preset` 优先于 `APP_PRESET`，省略时默认为 `customer-service`。既有 `systemPrompt` 仍可覆盖默认组合提示词，`demoTools` 仍可在 mock 模式显式覆盖默认值；live 禁止模拟业务工具。预设仅是服务端启动装配，不接受聊天请求覆盖，变更后需要重启。前端从公开配置读取预设，并更新标题、示例问题和提示文字，不提供客户端切换业务规则的入口。

## 回答策略插件

`responsePolicy` 是可替换 Provider，契约复用 `AnswerPolicy`，通过 `provide: ['responsePolicy']` 发布。基础 Guard 先验证引用真实性，再调用回答策略，最后执行追加的行业策略。策略收到独立快照，不能通过修改参数重写原响应或权威状态。

例如，独立插件项目可发布一个严格知识策略：

```ts
import { AppError, checkAbort, type HarnessPlugin } from '@ava/harness/plugin';

export const knowledgeOnly: HarnessPlugin = {
  name: 'company-knowledge-only',
  provide: ['responsePolicy'],
  apply(ctx) {
    ctx.provide('responsePolicy', {
      name: 'company-knowledge-only',
      validate(_answer, citations, state, signal, responseType) {
        checkAbort(signal);
        if (responseType === 'ask_user') return;
        if (!state.retrievedDocuments.length || !citations.length)
          throw new AppError('KNOWLEDGE_REQUIRED', '请先补充知识依据。', 422);
      },
    });
  },
};
```

启动装配使用 `providers: { responsePolicy: knowledgeOnly }`。也可将独立项目构建为 JS，在 Ops 中选择“算法 Provider / 回答策略”，登记并启用。原生 Cordis `Config`、依赖、生命周期、配置校验和失败回退继续生效；停用后恢复应用 Provider 或当前预设的默认策略。

策略优先级为：已启用的 Ops Provider → `options.providers.responsePolicy` → 预设默认策略。更改预设不会覆盖已经启用并持久化的 Ops Provider。切换仍影响整个 Harness，并会取消、等待当前运行；不是按会话切换，也不提供无中断热更新。

替换回答策略可以改变证据要求，不能关闭工具权限、身份校验、审计、引用真实性或其他行业策略。插件仍是受信任的进程代码，不是沙箱。模型与业务插件也应遵守服务端预算和对象级授权。

## 组合自己的应用

应用预设是普通的 `HarnessOptions` 装配，不需要另一套插件框架。行业项目可以像现有 `examples/retail` 一样，用函数返回预设、提示词、Providers 和扩展插件。

例如，从知识预设出发提供检索工具，同时替换回答策略来允许部分常识回答；或从聊天预设出发，由业务插件追加获准使用的工具。预设不会自动授予工具权限，也不会把输入转换成多模态协议。文档处理流水线、独立上下文策略和完整评测能力仍是后续工作。

前后端与 SDK 需同步构建部署，Ops 的 Provider 枚举新增了 `responsePolicy`；新聊天客户端读取旧服务端配置时，会回退为客服预设。
