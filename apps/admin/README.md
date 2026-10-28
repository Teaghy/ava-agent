# Admin

管理端入口骨架，尚未实现页面或独立服务，不参与 dev/build。

面向业务管理员维护客服业务内容。Harness 插件发布、装配、启停和故障恢复属于独立 `apps/ops` 维护端，不放入此应用。

后续页面分为 knowledge、conversations、agents、tools、prompts、traces、evaluation，通过 @ava/sdk 调用 Harness API；鉴权由 Harness 服务端执行。
