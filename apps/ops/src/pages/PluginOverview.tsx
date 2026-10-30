import { useState, type ReactNode } from 'react';
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  Cpu,
  Database,
  FileSearch,
  Globe,
  Layers3,
  LockKeyhole,
  Network,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react';
import type { PluginManagerSnapshot, ProviderView, RuntimePluginView } from '@ava/protocol';
import './plugin-overview.css';

const statusLabels = {
  active: '运行中',
  loading: '加载中',
  failed: '运行异常',
  disabled: '未启用',
};
const sourceLabels = { default: '内置默认', application: '应用配置', plugin: '外部插件' };
const capabilityInfo = {
  decision: {
    title: '执行决策',
    description: '判断下一步是检索资料、调用工具还是回复。',
    icon: BrainCircuit,
  },
  model: { title: '语言模型', description: '为执行决策和最终回答提供生成能力。', icon: Cpu },
  embedding: {
    title: '文本向量化',
    description: '将知识和问题编码为可检索的向量。',
    icon: Network,
  },
  reranker: {
    title: '检索重排序',
    description: '决定检索资料进入回答上下文的顺序。',
    icon: SlidersHorizontal,
  },
  memory: { title: '长期记忆', description: '保存并召回当前用户的长期事实。', icon: Database },
  rag: { title: '知识检索', description: '编排查询、融合结果并选择参考资料。', icon: FileSearch },
  responsePolicy: {
    title: '回答策略',
    description: '约束回答需要哪些知识或工具依据。',
    icon: ShieldCheck,
  },
};
const categories = [
  { key: 'engine', label: '执行与回答', icon: Bot },
  { key: 'model', label: '模型与兼容', icon: Cpu },
  { key: 'knowledge', label: '知识与检索', icon: FileSearch },
  { key: 'tool', label: '工具与校验', icon: Wrench },
  { key: 'storage', label: '存储与记忆', icon: Database },
  { key: 'ops', label: '维护与观测', icon: SlidersHorizontal },
  { key: 'transport', label: '接口与页面', icon: Globe },
  { key: 'extension', label: '其他扩展', icon: Layers3 },
] as const;

function Status({ status }: { status?: ProviderView['status'] }) {
  return (
    <span className={`overview-status overview-status-${status ?? 'unknown'}`}>
      <i aria-hidden="true" />
      {status ? statusLabels[status] : '状态未提供'}
    </span>
  );
}
function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="overview-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CapabilityOverview({ snapshot }: { snapshot?: PluginManagerSnapshot }) {
  return (
    <section className="plugins-panel plugin-overview" aria-labelledby="plugin-providers-title">
      <div className="plugins-section-heading">
        <div>
          <h2 id="plugin-providers-title">
            当前能力提供方{' '}
            {snapshot && <span className="plugins-count">{snapshot.providers.length}</span>}
          </h2>
          <p>每项能力当前使用的实现，展开查看来源与配置入口。</p>
        </div>
        <Layers3 size={19} />
      </div>
      {snapshot?.providers.length ? (
        <div className="overview-cards overview-capabilities">
          {snapshot.providers.map((provider) => {
            const info = capabilityInfo[provider.slot];
            const Icon = info.icon;
            const implementation = snapshot.runtimePlugins.find((plugin) =>
              plugin.services.includes(provider.slot),
            );
            return (
              <details className="overview-card" key={provider.slot}>
                <summary aria-label={`${info.title}，${provider.name}，展开详情`}>
                  <div className="overview-card-top">
                    <span className={`overview-icon overview-icon-${provider.slot}`}>
                      <Icon size={18} strokeWidth={1.7} />
                    </span>
                    <Status status={provider.status} />
                    <ChevronDown className="overview-chevron" size={14} />
                  </div>
                  <h3>{info.title}</h3>
                  <p>{info.description}</p>
                  <div className="overview-card-meta">
                    <code title={provider.name}>{provider.name}</code>
                    <span>{sourceLabels[provider.source]}</span>
                  </div>
                </summary>
                <div className="overview-card-details">
                  <Facts
                    items={[
                      ['服务槽位', <code>{provider.slot}</code>],
                      ['提供来源', sourceLabels[provider.source]],
                      ['当前实现', <code>{provider.name}</code>],
                      ...(implementation
                        ? ([
                            ['提供服务', implementation.services.join('、') || '注册扩展'],
                            [
                              '服务依赖',
                              implementation.dependencies.map((dep) => dep.name).join('、') || '无',
                            ],
                          ] satisfies [string, ReactNode][])
                        : []),
                    ]}
                  />
                  {(provider.slot === 'model' || provider.slot === 'embedding') &&
                    provider.source !== 'plugin' && (
                      <a className="overview-action" href="#models">
                        前往模型配置 <ChevronDown size={12} />
                      </a>
                    )}
                  {provider.pluginId && (
                    <a
                      className="overview-action"
                      href={`#plugin-${provider.pluginId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document
                          .getElementById(`plugin-${provider.pluginId}`)
                          ?.scrollIntoView({ block: 'center' });
                      }}
                    >
                      查看外部插件 <ChevronDown size={12} />
                    </a>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="overview-empty">
          {snapshot ? '当前没有能力提供方。' : '连接维护服务后查看各项能力的实际实现。'}
        </p>
      )}
    </section>
  );
}

export function RuntimePluginOverview({ snapshot }: { snapshot?: PluginManagerSnapshot }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | RuntimePluginView['source']>('all');
  const entries = snapshot?.runtimePlugins ?? [];
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = entries.filter(
    (plugin) =>
      (source === 'all' || source === plugin.source) &&
      (!normalized ||
        [
          plugin.name,
          plugin.label,
          plugin.description,
          ...plugin.services,
          ...plugin.dependencies.map((dep) => dep.name),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalized)),
  );
  return (
    <section className="plugins-panel plugin-overview" aria-labelledby="runtime-plugins-title">
      <div className="plugins-section-heading">
        <div>
          <h2 id="runtime-plugins-title">
            内置与应用插件 {snapshot && <span className="plugins-count">{entries.length}</span>}
          </h2>
          <p>当前已装配的运行模块；展开查看职责、服务和依赖。</p>
        </div>
        <span className="overview-readonly">
          <LockKeyhole size={13} />
          运行清单
        </span>
      </div>
      <div className="overview-toolbar">
        <label className="overview-search">
          <Search size={15} aria-hidden="true" />
          <span className="overview-sr-only">搜索内置与应用插件</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、能力或服务…"
            disabled={!snapshot}
          />
          {query && (
            <button type="button" aria-label="清空插件搜索" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </label>
        <div className="overview-filters" aria-label="插件来源筛选">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'builtin', label: '内置' },
              { key: 'application', label: '应用扩展' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={source === item.key}
              onClick={() => setSource(item.key)}
            >
              {item.label}
              <span>
                {item.key === 'all'
                  ? entries.length
                  : entries.filter((plugin) => plugin.source === item.key).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="overview-groups">
        {categories.map((category) => {
          const plugins = filtered.filter((plugin) => plugin.category === category.key);
          const Icon = category.icon;
          if (!plugins.length) return null;
          return (
            <details
              className="overview-group"
              key={category.key}
              open={!!normalized || category.key === 'engine' || category.key === 'model'}
            >
              <summary>
                <Icon size={16} />
                <h3>{category.label}</h3>
                <span>{plugins.length}</span>
                <ChevronDown className="overview-chevron" size={14} />
              </summary>
              <div className="overview-cards overview-runtime-cards">
                {plugins.map((plugin) => (
                  <details className="overview-card overview-runtime-card" key={plugin.id}>
                    <summary aria-label={`${plugin.label}，${plugin.name}，展开详情`}>
                      <div className="overview-runtime-heading">
                        <strong>{plugin.label}</strong>
                        <Status status={plugin.status} />
                        <ChevronDown className="overview-chevron" size={13} />
                      </div>
                      <p>{plugin.description}</p>
                      <div className="overview-card-meta">
                        <code title={plugin.name}>{plugin.name}</code>
                        <span>{plugin.source === 'builtin' ? '内置' : '应用扩展'}</span>
                      </div>
                    </summary>
                    <div className="overview-card-details">
                      <Facts
                        items={[
                          ['模块标识', <code>{plugin.name}</code>],
                          [
                            '提供服务',
                            plugin.services.length ? (
                              <div className="overview-chips">
                                {plugin.services.map((service) => (
                                  <code key={service}>{service}</code>
                                ))}
                              </div>
                            ) : (
                              '注册工具、知识源或接口'
                            ),
                          ],
                          [
                            '服务依赖',
                            plugin.dependencies.length ? (
                              <div className="overview-chips">
                                {plugin.dependencies.map((dep) => (
                                  <code key={dep.name}>
                                    {dep.name}
                                    {!dep.required && '（可选）'}
                                  </code>
                                ))}
                              </div>
                            ) : (
                              '无'
                            ),
                          ],
                          [
                            '管理方式',
                            plugin.source === 'builtin' ? '随底座装配' : '由应用配置装配',
                          ],
                        ]}
                      />
                      {plugin.name === 'model-compatibility' && (
                        <a href="#models" className="overview-action">
                          查看模型兼容设置 <ChevronDown size={12} />
                        </a>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          );
        })}
        {!filtered.length && (
          <p className="overview-empty">
            {!snapshot
              ? '连接维护服务后读取实际运行模块。'
              : entries.length
                ? '没有匹配的插件，试试其他关键词或来源。'
                : '服务尚未返回运行清单，请更新服务端后刷新。'}
          </p>
        )}
      </div>
      <p className="overview-footnote">
        <LockKeyhole size={13} />
        内置模块与应用扩展由服务启动配置管理；外部安装项在下方单独维护。
      </p>
    </section>
  );
}
