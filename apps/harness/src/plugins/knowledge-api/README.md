# knowledge-api

提供管理员知识导入及运行回放接口。入口与实现为 [knowledgeApiPlugin](index.ts)。

## 依赖与配置

- 必需：`http`、`rag`、`eventStore`；不提供新的 Cordis 服务。
- 参数为 [AuthConfig](../../core/http/auth.ts)，使用服务端 `API_KEYS` 中的 Principal。
- 两个接口均要求 `principal.admin=true`，普通 READ/WRITE 权限不替代管理员标识；匿名身份无权调用。
- 路由通过 `ctx.effect` 注册，卸载时注销。

## 知识导入

`POST /api/v1/knowledge`：

```json
{
  "id": "manual-v1",
  "title": "设备故障处理",
  "content": "# E102\n请先检查耗材安装。",
  "metadata": { "model": "VCD-2000", "version": "1" }
}
```

可选 `source` 须为 URL。id 最长 100 字符、title 最长 300 字符、content 最长 50000 字符；metadata 必填，可使用空对象，只允许 product、model、category、errorCode、version、language、department。详细约束见 [knowledgeDocumentSchema](../../../../../packages/protocol/src/knowledge/index.ts)。HTTP 层另有 64 KiB 请求体限制。

租户由已认证身份确定，不接受 body 指定租户。成功返回 201 和 `{ chunks: 分片数量 }`；当前 RAG 委托默认 `qdrant` 知识源导入。文档更新需使用新版本 ID，见 [knowledge-qdrant](../knowledge-qdrant/README.md)。

## 运行回放

`POST /api/v1/runs/replay` 接收严格的 `{ "runId": "合法 UUID" }`，返回当前租户下的 `{ events, checkpoint }`。它只读取轨迹与最后检查点，不重新执行 Agent，也不重试业务工具。

参见 [event-store](../event-store/README.md) 与 [插件索引](../README.md)。
