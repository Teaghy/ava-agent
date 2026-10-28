# http-h3

使用 H3 和 Node HTTP 提供传输层。入口为 [httpH3Plugin](index.ts)，实现为 [H3HttpService](http.service.ts)。

## 服务与配置

- 提供 `ctx.http`（[HttpService](../../core/http/http.service.ts)），无服务依赖和插件参数。
- bootstrap 调用 `start(PORT, HOST)`；默认 `PORT=3000`、`HOST=127.0.0.1`，支持端口 0。
- API 插件使用 core 的请求/响应接口，不直接依赖 H3 对象。

## 路由与请求

`get()` / `post()` / `route()` 注册精确路径，`static()` 注册静态资源前缀；重复注册报错，返回函数用于注销。JSON 请求体上限 65536 字节，格式错误返回 400，超限返回 413；公开错误响应不暴露内部异常。

静态服务仅允许 html、js、css、svg、ico、woff2，拒绝隐藏路径和解析到资源根目录外的文件。HTML 添加同源 CSP，资源添加 `nosniff`；缺失资源返回 404，没有任意路径的 SPA fallback。

## SSE 与生命周期

响应提供 `stream(emit, signal)` 时使用 SSE，按事件类型发送命名事件，data 为 JSON；每 15 秒发送 `ping`。设置 `X-Accel-Buffering: no` 和 `Cache-Control: no-cache, no-transform`，客户端或代理仍需支持及时转发流。

断开连接会中止请求信号；卸载插件时停止服务、取消活动请求并关闭连接。Node 请求超时 100 秒、请求头超时 10 秒。启动由 bootstrap 显式调用，注册插件本身不会立刻监听端口。

本层不处理用户身份或 Agent 业务；没有内置 CORS、`Last-Event-ID` 续传。当前 Web 使用同源 API，Vite 开发时使用代理。参见 [chat-api](../chat-api/README.md) 与 [web-static](../web-static/README.md)。
