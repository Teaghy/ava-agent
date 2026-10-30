import { FiberState, type Fiber } from 'cordis';
import type { RuntimePluginView } from '@ava/protocol';

type Metadata = Pick<RuntimePluginView, 'label' | 'description' | 'category'>;
const metadata: Record<string, Metadata> = {
  'model-compatibility': {
    label: '模型兼容',
    description: '按模型与服务地址匹配消息格式、JSON 和流式参数规则。',
    category: 'model',
  },
  'model-openai': {
    label: '语言模型',
    description: '通过 OpenAI 兼容接口提供生成、流式正文和结构化输出。',
    category: 'model',
  },
  'model-mock': {
    label: '模拟语言模型',
    description: '提供无需外部凭据的确定性演示回答。',
    category: 'model',
  },
  embedding: {
    label: '文本向量化',
    description: '将查询与知识分片转换成检索向量。',
    category: 'model',
  },
  'reranker-noop': {
    label: '检索重排序',
    description: '承接检索结果重排序；默认实现保持输入顺序。',
    category: 'knowledge',
  },
  'decision-main-model': {
    label: '主模型决策',
    description: '生成结构化决策，选择检索、调用工具或回答。',
    category: 'engine',
  },
  'answer-model': {
    label: '回答生成',
    description: '根据上下文与引用依据生成最终回答正文。',
    category: 'engine',
  },
  'agent-loop': {
    label: 'Agent 执行循环',
    description: '控制执行步数、工具预算、取消和运行检查点。',
    category: 'engine',
  },
  'answer-guard': {
    label: '回答校验',
    description: '校验知识依据、引用和行业回答规则。',
    category: 'tool',
  },
  'response-policy': {
    label: '回答策略',
    description: '按应用预设约束回答所需的知识或工具依据。',
    category: 'tool',
  },
  tools: { label: '工具注册', description: '管理工具契约、执行权限与调用审计。', category: 'tool' },
  'knowledge-tools': {
    label: '知识检索工具',
    description: '向 Agent 提供知识检索调用入口。',
    category: 'knowledge',
  },
  'mock-business-tools': {
    label: '模拟业务工具',
    description: '仅在演示模式提供模拟业务操作。',
    category: 'tool',
  },
  'knowledge-registry': {
    label: '知识源注册',
    description: '汇集已注册知识源并路由检索请求。',
    category: 'knowledge',
  },
  'knowledge-qdrant': {
    label: '已发布知识源',
    description: '结合向量与关键词检索 SQL 中已发布的知识。',
    category: 'knowledge',
  },
  'knowledge-cases': {
    label: '案例知识源',
    description: '提供案例类知识检索。',
    category: 'knowledge',
  },
  rag: {
    label: '知识检索编排',
    description: '完成查询改写、结果融合、重排和上下文选择。',
    category: 'knowledge',
  },
  sessions: {
    label: '会话管理',
    description: '管理历史消息、摘要与运行状态。',
    category: 'storage',
  },
  'event-store': {
    label: '运行事件存储',
    description: '追加执行事件并支持轨迹回放。',
    category: 'storage',
  },
  'memory-storage': {
    label: '长期记忆',
    description: '通过存储服务持久保存和召回用户事实。',
    category: 'storage',
  },
  'memory-mem0': {
    label: 'Mem0 长期记忆',
    description: '通过 Mem0 服务保存与召回租户和用户隔离的记忆。',
    category: 'storage',
  },
  'storage-memory': {
    label: '内存存储',
    description: '在当前进程保存会话、知识与审计数据。',
    category: 'storage',
  },
  'storage-postgres': {
    label: 'PostgreSQL 存储',
    description: '持久保存会话、知识分片、运行事件与审计数据。',
    category: 'storage',
  },
  'cache-memory': {
    label: '内存缓存',
    description: '在当前进程提供缓存、执行锁与限流。',
    category: 'storage',
  },
  'cache-redis': {
    label: 'Redis 缓存',
    description: '提供共享缓存、锁与请求限流。',
    category: 'storage',
  },
  'vector-memory': {
    label: '内存向量索引',
    description: '在当前进程保存与查询知识向量。',
    category: 'storage',
  },
  'vector-qdrant': {
    label: 'Qdrant 向量索引',
    description: '按租户查询和维护已发布知识向量。',
    category: 'storage',
  },
  observability: {
    label: '日志与观测',
    description: '记录调用耗时、用量和结构化运行日志。',
    category: 'ops',
  },
  'ops-console': {
    label: 'Ops 维护控制台',
    description: '托管独立的插件、模型和运行排查入口。',
    category: 'ops',
  },
  'ops-runs-api': {
    label: '运行排查接口',
    description: '按授权租户查询运行列表及执行轨迹。',
    category: 'ops',
  },
  'plugin-manager-api': {
    label: '外部插件维护接口',
    description: '提供插件包上传、配置、启停与切换入口。',
    category: 'ops',
  },
  'model-settings-api': {
    label: '模型配置接口',
    description: '验证并热切换模型配置与知识索引。',
    category: 'ops',
  },
  'http-h3': {
    label: 'HTTP 与 SSE',
    description: '提供业务 HTTP 监听和事件流传输。',
    category: 'transport',
  },
  'chat-api': {
    label: '对话接口',
    description: '认证请求并向客户端传递回答与运行状态。',
    category: 'transport',
  },
  'conversations-api': {
    label: '会话接口',
    description: '按用户权限读取、恢复和删除会话。',
    category: 'transport',
  },
  'knowledge-api': {
    label: '知识导入接口',
    description: '向管理员提供租户知识导入入口。',
    category: 'transport',
  },
  'web-static': {
    label: '客服页面托管',
    description: '提供聊天页面静态资源与公开客户端配置。',
    category: 'transport',
  },
};

export function runtimeStatus(fiber?: Fiber): RuntimePluginView['status'] {
  if (!fiber || fiber.uid === null || fiber.state === FiberState.DISPOSED) return 'disabled';
  if (fiber.state === FiberState.ACTIVE) return 'active';
  if (fiber.state === FiberState.FAILED) return 'failed';
  return 'loading';
}
export function describeRuntimePlugin(name: string): Metadata {
  return (
    metadata[name] ?? {
      label: name,
      description: '由应用装配的运行时扩展。展开查看服务与依赖。',
      category: 'extension',
    }
  );
}
