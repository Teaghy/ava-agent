# 澄风智能客服演示知识库

这是为当前 Ava 基座准备的虚构电商售后资料，产品为家用空气净化器 CF-A200。品牌、参数、故障码、服务时效和售后政策均为演示编写，不是真实厂家资料。正式使用前应由企业逐项审核并替换。

## 文件用途

| 文件                | 内容                                                               |
| ------------------- | ------------------------------------------------------------------ |
| 01-product.md       | 产品参数、功能、价格与售前边界                                     |
| 02-orders.md        | 订单状态、取消和改址                                               |
| 03-shipping.md      | 发货、物流异常、破损和签收争议                                     |
| 04-returns.md       | 退换货、运费、退款状态和时效                                       |
| 05-warranty.md      | 保修范围、购买凭证和维修                                           |
| 06-filter.md        | 滤芯安装、清洁、更换和复位                                         |
| 07-e01.md           | CF-A200 E01 的盖板检查流程                                         |
| 08-e02.md           | CF-A200 E02 的停止使用与售后处理                                   |
| 09-human-handoff.md | 人工接管、服务时间和投诉                                           |
| 10-privacy.md       | 身份核验、个人信息与支付信息                                       |
| documents.json      | 以上 10 篇资料的批量导入数据，每项符合当前 knowledgeDocumentSchema |
| evaluation.json     | 20 个测试问题与人工检查要点，不应作为知识导入                      |

每篇文档自带演示标记和适用范围，metadata 包含产品、型号、分类、语言、版本；故障文档另有 errorCode。未填写 source URL，避免生成不存在的官方链接；仍可通过文档名称和分片 ID 引用。

本资料与默认 VCD-2000 演示知识是不同产品，不能交叉套用故障码。需要单独检索时使用 filters.model=CF-A200。department 只是资料标签，不代表部门授权。

## 导入当前服务

当前接口每次接收一篇文档，不直接接收 JSON 数组。下面从仓库根目录运行 PowerShell，逐篇导入。先将**业务端管理员**的 Token 放入当前终端环境变量 AVA_BUSINESS_TOKEN；该身份须配置在 API_KEYS 中并具有 admin:true。Ops Token 和普通聊天 READ Token 不能导入知识。

```powershell
if (-not $env:AVA_BUSINESS_TOKEN) { throw '请先设置业务管理员 Token：AVA_BUSINESS_TOKEN' }
$kbDocuments = Get-Content -Raw -Encoding UTF8 -LiteralPath examples/customer-service-knowledge/documents.json | ConvertFrom-Json
foreach ($kbDocument in $kbDocuments) {
  $kbBody = $kbDocument | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/v1/knowledge' -Headers @{ Authorization = "Bearer $env:AVA_BUSINESS_TOKEN" } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($kbBody))
}
```

导入租户由管理员 Token 决定，请确认聊天用户属于同一租户。使用内存存储时，重启会清空导入内容。生产版本的文档内容变化应使用新的文档 ID；不要原 ID 覆盖，本基座还需要进一步建设旧版本下线管理。

若先修改 Markdown，导入前应将对应内容同步到 documents.json；运行以下命令可保持 JSON 文档正文与编号 Markdown 一致：

```bash
node --input-type=module -e "import fs from 'node:fs'; const p='examples/customer-service-knowledge/'; const d=JSON.parse(fs.readFileSync(p+'documents.json','utf8')); for(const x of d){const f=x.id.replace(/^chengfeng-/,'').replace(/-v1$/,'')+'.md'; x.content=fs.readFileSync(p+f,'utf8').trim(); x.title=x.content.split('\n')[0].replace(/^# /,'');} fs.writeFileSync(p+'documents.json',JSON.stringify(d,null,2)+'\n');"
```

## 测试范围

导入完成后可从 evaluation.json 选择问题检查：是否检索到对应资料、回答是否支持引用、是否区分政策说明与真实业务结果，以及是否正确追问或转人工。

知识文档不能代替运行时安全策略。隐私和人工接管文档需要配合服务端权限、真实订单/工单工具及有效的人工入口。当前 mock 模型仅用于验证流程，不代表真实模型的客服回答质量；上传的固定追问示例插件也不适合作为这套知识库的客服决策实现。
