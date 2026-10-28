# 零售客服插件示例

```bash
pnpm install
pnpm example:retail
```

示例通过 `@ava/harness` 与 `@ava/harness/plugin` 接入，使用规则决策替换默认主模型决策，并关闭模型和设备演示工具。默认运行不需要模型 Key、数据库或 Docker，执行两轮演示后自动停止。

- [retail.ts](src/retail.ts)：Provider、知识源、订单工具和行业审核装配。
- [demo-data.ts](src/demo-data.ts)：虚构订单与配送政策适配器；不是生产业务实现。
- [run.ts](src/run.ts)：创建底座、执行问答、停止并释放资源。
- [retail.test.ts](tests/retail.test.ts)：通过公开 API 验证订单、引用、对象权限、审核和卸载。

将 `lookupOrder`、`searchKnowledge`、`reviewAnswer` 替换为自己的业务接口、检索算法和审核逻辑即可复用装配结构。订单工具会在适配器返回结果后再次校验订单 ID、租户与用户；查询失败不会泄露订单状态。

详细扩展约定见 [插件开发文档](../../docs/plugin-development.md)。示例只展示 READ 工具；真实业务写入还需要业务幂等与授权设计。
