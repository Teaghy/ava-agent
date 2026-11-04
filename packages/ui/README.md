# 共享界面控件

Web、Admin 和 Ops 共用的 Radix 控件与样式。下拉框、复选框、日期时间选择、弹窗与确认框在这里维护；应用内沿用各自的页面布局。

在入口引入 `@ava/ui/styles.css`，使用 `UIProvider` 包裹应用。`Select`、`Checkbox`、`DateTimePicker` 支持 `name`，可继续通过 `FormData` 读取。日期时间保持浏览器本地时间，由调用方在请求时转换时区。

Radix 弹层需要动态样式。静态 HTML 服务为每次响应生成 CSP nonce，通过 `csp-nonce` meta 交给控件，避免放开 `unsafe-inline`。更换静态托管服务时须保留此约定。
