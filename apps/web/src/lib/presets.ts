import { BookOpen, CircleHelp, MessageSquare, Wrench } from 'lucide-react';

export const presetCopy = {
  'customer-service': {
    label: '智能客服',
    tagline: '设备问题，我们一起解决。',
    description: '从一个故障现象开始，我会帮你查找知识、梳理原因，找到有据可循的解决方法。',
    placeholder: '描述设备型号、故障现象，或你想了解的问题…',
    trust: ['基于知识库回答', '参考来源可追溯'],
    demoHint: '当前为演示模式 · 试试 VCD-2000 的 E102 故障排查',
    footnote: 'Ava 的回答供参考，设备操作请遵循官方安全规程。',
    starters: [
      {
        icon: Wrench,
        title: '排查设备故障',
        text: '更换耗材后，一直报 E102',
        query: '我的 VCD-2000 换完耗材以后一直报 E102，怎么处理？',
      },
      {
        icon: BookOpen,
        title: '查找操作指引',
        text: '了解真空校准的前置检查',
        query: 'VCD-2000 执行真空校准前需要检查什么？',
      },
      {
        icon: CircleHelp,
        title: '了解故障原因',
        text: 'E102 真空状态异常是什么意思？',
        query: 'VCD-2000 的 E102 真空状态异常有哪些可能原因？',
      },
    ],
  },
  knowledge: {
    label: '知识问答',
    tagline: '从知识中找到可靠答案。',
    description: '提出你的问题，我会查找已接入的知识，提供回答和可核对的参考来源。',
    placeholder: '输入你想从知识库了解的问题…',
    trust: ['依据知识文档回答', '参考来源可追溯'],
    demoHint: '当前为演示模式 · 需要先由维护人员导入知识文档',
    footnote: '请结合原文核对答案；知识不足时会请求补充信息。',
    starters: [
      {
        icon: BookOpen,
        title: '查找知识',
        text: '找到与问题相关的资料',
        query: '知识库中有哪些入门指引？请给出来源。',
      },
      {
        icon: MessageSquare,
        title: '归纳要点',
        text: '依据文档整理关键内容',
        query: '请根据知识库概括主要操作流程，并注明引用来源。',
      },
      {
        icon: CircleHelp,
        title: '核对依据',
        text: '查看结论对应的原文',
        query: '请查找常见问题的处理说明，并列出依据。',
      },
    ],
  },
  chat: {
    label: 'AI 对话',
    tagline: '聊想法，也聊你的下一步。',
    description: '解释概念、协助写作或整理思路，从你现在想做的事情开始。',
    placeholder: '输入问题，或描述你想完成的事情…',
    trust: ['自由对话', '工具按需使用'],
    demoHint: '当前为模拟模式 · 回复用于验证流程，不代表真实模型能力',
    footnote: 'AI 可能产生不准确的信息，请核对重要内容。',
    starters: [
      {
        icon: MessageSquare,
        title: '协助写作',
        text: '把想法整理成文字',
        query: '帮我写一封简短、清楚的会议邀请邮件。',
      },
      {
        icon: CircleHelp,
        title: '解释概念',
        text: '用容易理解的方式说明',
        query: '请用生活中的例子解释什么是机器学习。',
      },
      {
        icon: BookOpen,
        title: '整理思路',
        text: '把任务拆成可执行的步骤',
        query: '帮我列出准备一次项目讨论会的步骤。',
      },
    ],
  },
};
