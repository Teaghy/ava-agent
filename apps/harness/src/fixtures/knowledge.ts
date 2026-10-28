import type { KnowledgeDocument } from '../core/rag/retrieval.types.js';
export const demoKnowledge: KnowledgeDocument = {
  id: 'vcd-2000-e102-v1',
  title: 'VCD-2000 E102 故障排查 SOP',
  source: 'https://example.com/manuals/vcd-2000/e102',
  metadata: {
    product: 'VCD',
    model: 'VCD-2000',
    errorCode: 'E102',
    category: 'troubleshooting',
    version: '1',
    language: 'zh-CN',
  },
  content:
    '# E102：真空状态异常\n\n适用设备：VCD-2000。更换耗材后持续出现 E102，表示真空状态异常。\n\n## 可能原因\n\n1. 耗材安装后密封不完整。\n2. 真空管路泄漏。\n3. 真空传感器异常。\n\n## 排查步骤\n\n1. 检查耗材是否正确安装。\n2. 检查密封是否完整。\n3. 检查真空管路是否泄漏。\n4. 由授权人员按照设备 SOP 执行真空校准。\n\n若故障持续，联系售后检查真空传感器。此内容为演示知识，请勿替代真实厂家安全规程。',
};
