# application-access

业务应用与凭证管理插件，依赖 http、storage、telemetry，提供 applicationAccess 服务。环境应用凭证幂等导入持久存储，运行认证按共享数据库查询，停用与撤销即时生效。业务管理 API 仅授权租户管理员，不接受应用 Key 或 Ops Token。

数据库只保存凭证摘要，明文只在签发响应返回一次；列表不含 hash 或 secret。稳定应用与知识空间不可在线更换，状态修改使用版本校验。接口与迁移规则见 [应用接入](../../../../../docs/application-access.md)。
