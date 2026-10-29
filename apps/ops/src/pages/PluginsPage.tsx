import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AgentClient, ApiError } from '@ava/sdk';
import type {
  PluginActionRequest,
  PluginInstallRequest,
  PluginManagerSnapshot,
  PluginSlot,
  OpsAccess,
} from '@ava/protocol';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PackagePlus,
  Pause,
  Play,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Settings2,
  Trash2,
} from 'lucide-react';
import { changePlugin, configurePlugin, installPlugin, loadPlugins } from '../services/plugins';
import './plugins.css';
import { RunsPanel } from './RunsPanel';

const slots: { value: PluginSlot; label: string }[] = [
  { value: 'decision', label: '决策 · Decision' },
  { value: 'model', label: '语言模型 · Model' },
  { value: 'embedding', label: '向量化 · Embedding' },
  { value: 'reranker', label: '重排序 · Reranker' },
  { value: 'memory', label: '记忆 · Memory' },
  { value: 'rag', label: '知识检索 · RAG' },
  { value: 'responsePolicy', label: '回答策略 · Response policy' },
];
const sourceLabels = { default: '默认', application: '应用配置', plugin: '插件' };
const statusLabels = { active: '运行中', disabled: '已停用', failed: '加载失败' };

function requestError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return 'Token 无效或已过期，请更换有效的平台维护人员 Token 后重新连接。';
    if (error.status === 403) return '当前身份没有执行此操作的维护权限。';
    return error.message;
  }
  if (error instanceof TypeError) return '无法连接服务，请检查网络与服务器状态后重试。';
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}

export function PluginsPage() {
  const [page, setPage] = useState(location.hash === '#runs' ? 'runs' : 'plugins');
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const [access, setAccess] = useState<OpsAccess>();
  const [snapshot, setSnapshot] = useState<PluginManagerSnapshot>();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removeId, setRemoveId] = useState<string>();
  const [configureId, setConfigureId] = useState<string>();
  const [replacementConfig, setReplacementConfig] = useState('{}');
  const [name, setName] = useState('');
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState<PluginInstallRequest['kind']>('extension');
  const [slot, setSlot] = useState<PluginSlot>('model');
  const [config, setConfig] = useState('');
  const [enabled, setEnabled] = useState(true);
  const request = useRef<AbortController | null>(null);
  const tokenField = useRef<HTMLInputElement>(null);
  const busy = !!pending;
  const canManage = !!token && !!access?.managePlugins && !!snapshot?.enabled && !busy;

  useEffect(() => {
    const title = document.title;
    document.title = '插件维护 · Harness Ops';
    return () => {
      request.current?.abort();
      document.title = title;
    };
  }, []);

  useEffect(() => {
    const navigate = () => setPage(location.hash === '#runs' ? 'runs' : 'plugins');
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    document.title = `${page === 'runs' ? '运行排查' : '插件维护'} · Harness Ops`;
  }, [page]);

  const run = async (
    label: string,
    operation: (signal: AbortSignal) => Promise<PluginManagerSnapshot | undefined>,
    onSuccess?: () => void,
  ) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(label);
    setError('');
    setNotice('');
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(result);
      setRemoveId(undefined);
      onSuccess?.();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(requestError(cause));
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setToken('');
        setAccess(undefined);
        setSnapshot(undefined);
        tokenField.current?.focus();
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending('');
      }
    }
  };

  const loadAccess = async (candidate: string, signal: AbortSignal) => {
    const next = await new AgentClient({ token: candidate }).ops.access(signal);
    const plugins = next.managePlugins ? await loadPlugins(candidate, signal) : undefined;
    if (signal.aborted) return;
    setAccess(next);
    if (!next.managePlugins) {
      location.hash = 'runs';
      setPage('runs');
    } else if (!next.inspectRuns) {
      location.hash = 'plugins';
      setPage('plugins');
    }
    return plugins;
  };

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const candidate = tokenInput.trim();
    if (!candidate || busy) return;
    void run(
      '正在连接管理服务…',
      (signal) => loadAccess(candidate, signal),
      () => {
        setToken(candidate);
        setTokenInput('');
        setNotice('已读取服务器当前状态。');
      },
    );
  };

  const install = (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    setNotice('');
    let parsed: Record<string, unknown> | undefined;
    try {
      if (config.trim()) {
        const value: unknown = JSON.parse(config);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('配置必须是 JSON 对象，例如 { "timeout": 30000 }。');
        }
        parsed = value as Record<string, unknown>;
      }
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? '配置 JSON 格式有误，请检查引号、逗号与括号。'
          : requestError(cause),
      );
      return;
    }
    const absoluteEntry = entry.trim();
    if (
      !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(absoluteEntry) ||
      !/\.(?:js|mjs|cjs)$/i.test(absoluteEntry)
    ) {
      setError('请填写服务器本地的绝对 JS 文件路径，以 .js、.mjs 或 .cjs 结尾。');
      return;
    }
    const input: PluginInstallRequest = {
      name: name.trim(),
      entry: absoluteEntry,
      kind,
      enabled,
      ...(kind === 'provider' ? { slot } : {}),
      ...(parsed ? { config: parsed } : {}),
    };
    void run(
      '正在登记插件并更新运行状态…',
      (signal) => installPlugin(token, input, signal),
      () => {
        setNotice('插件列表已更新，请查看实际运行状态。');
        setName('');
        setEntry('');
        setConfig('');
      },
    );
  };

  const action = (id: string, value: PluginActionRequest['action']) => {
    if (!canManage) return;
    const labels = { enable: '正在启用插件…', disable: '正在停用插件…', remove: '正在移除插件…' };
    void run(
      labels[value],
      (signal) => changePlugin(token, { id, action: value }, signal),
      () => {
        setNotice('服务器状态已更新。');
      },
    );
  };

  const configure = (event: FormEvent, id: string) => {
    event.preventDefault();
    if (!canManage) return;
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(replacementConfig);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('配置必须是 JSON 对象。');
      parsed = value as Record<string, unknown>;
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? '配置 JSON 格式有误，请检查引号、逗号与括号。'
          : requestError(cause),
      );
      return;
    }
    void run(
      '正在更新插件参数…',
      (signal) => configurePlugin(token, { id, config: parsed }, signal),
      () => {
        setConfigureId(undefined);
        setReplacementConfig('{}');
        setNotice('插件参数已更新；运行中的插件已按新参数重新装配。');
      },
    );
  };

  return (
    <div className="plugins-page">
      <a
        className="skip-link"
        href="#plugin-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('plugin-main')?.focus();
        }}
      >
        跳到维护内容
      </a>
      <header className="plugins-topbar">
        <a className="plugins-brand" href="/" aria-label="Harness Ops 首页">
          <Puzzle size={28} />
          <span>Harness Ops</span>
        </a>
        <span className="plugins-breadcrumb">
          <ChevronRight size={14} />
          系统维护<span>/</span>
          {page === 'runs' ? '运行排查' : '插件管理'}
        </span>
        <nav className="ops-nav" aria-label="维护功能">
          {(!access || access.managePlugins) && (
            <a href="#plugins" aria-current={page === 'plugins' ? 'page' : undefined}>
              插件维护
            </a>
          )}
          {(!access || access.inspectRuns) && (
            <a href="#runs" aria-current={page === 'runs' ? 'page' : undefined}>
              运行排查
            </a>
          )}
        </nav>
      </header>
      <main className="plugins-content" id="plugin-main" tabIndex={-1}>
        <div className="plugins-heading">
          <div>
            <span className="plugins-eyebrow">HARNESS OPERATIONS</span>
            <h1>{page === 'runs' ? '运行排查' : '插件维护'}</h1>
            <p>
              {page === 'runs'
                ? '定位每次提问的执行路径、工具结果与失败原因。'
                : '维护当前 Harness 的插件装配与运行状态。变更会暂停并取消当前任务。'}
            </p>
          </div>
          <span className="plugins-admin-label">
            <ShieldCheck size={15} />
            平台维护人员
          </span>
        </div>

        <section className="plugins-connection plugins-panel" aria-label="管理员连接">
          <div className="plugins-connection-copy">
            <span className="plugins-icon-tile">
              <KeyRound size={19} />
            </span>
            <div>
              <h2>{token ? '管理服务已连接' : '连接管理服务'}</h2>
              <p>
                {token
                  ? 'Token 仅保存在当前页面内存中，离开本页即清除。'
                  : '使用 OPS_API_KEYS 中专门配置的维护 Token，业务端 Token 无法连接。'}
              </p>
            </div>
          </div>
          {token ? (
            <div className="plugins-connection-actions">
              <button
                className="plugins-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    '正在刷新状态…',
                    (signal) => loadAccess(token, signal),
                    () => setNotice('已读取服务器当前状态。'),
                  )
                }
              >
                <RefreshCw size={14} />
                刷新状态
              </button>
              <button
                className="plugins-text-button"
                disabled={busy}
                onClick={() => {
                  setToken('');
                  setAccess(undefined);
                  setSnapshot(undefined);
                  setError('');
                  setNotice('');
                  setTokenInput('');
                  setRemoveId(undefined);
                }}
              >
                更换 Token
              </button>
            </div>
          ) : (
            <form className="plugins-token-form" onSubmit={connect}>
              <label className="sr-only" htmlFor="plugin-token">
                平台维护人员 Token
              </label>
              <input
                ref={tokenField}
                id="plugin-token"
                type="password"
                placeholder="输入平台维护人员 Token"
                value={tokenInput}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setTokenInput(event.target.value)}
                disabled={busy}
                required
              />
              <button
                className="plugins-button plugins-button-primary"
                disabled={busy || !tokenInput.trim()}
                type="submit"
              >
                {busy ? <LoaderCircle size={14} className="spinner" /> : <ArrowUpRight size={15} />}
                连接
              </button>
              <span className="plugins-token-hint">仅在内存中使用，不保存到浏览器。</span>
            </form>
          )}
        </section>

        {error && (
          <div className="plugins-feedback plugins-feedback-error" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
          </div>
        )}
        <div className="plugins-live-status" role="status" aria-live="polite">
          {pending ? (
            <>
              <LoaderCircle size={15} className="spinner" />
              {pending}
            </>
          ) : notice ? (
            <>
              <Check size={15} />
              {notice}
            </>
          ) : null}
        </div>
        {access && !(page === 'runs' ? access.inspectRuns : access.managePlugins) ? (
          <p role="status" className="plugins-feedback">
            此身份没有当前页面的访问权限，请选择已授权的维护功能。
          </p>
        ) : page === 'runs' ? (
          <RunsPanel key={token} token={token} />
        ) : (
          <>
            {snapshot && !snapshot.enabled && (
              <div className="plugins-feedback" role="status">
                <CircleAlert size={17} />
                <span>
                  此服务器尚未启用插件管理。请由部署管理员启用管理功能后刷新，当前无法登记或更改插件。
                </span>
              </div>
            )}
            {snapshot?.safeMode && (
              <div className="plugins-feedback" role="status">
                <ShieldCheck size={17} />
                <span>
                  服务器处于安全恢复模式，已跳过插件的自动恢复。请检查插件状态与配置，完成恢复后由部署管理员正常重启服务。
                </span>
              </div>
            )}

            <section
              className="plugins-providers plugins-panel"
              aria-labelledby="plugin-providers-title"
            >
              <div className="plugins-section-heading">
                <div>
                  <h2 id="plugin-providers-title">当前能力提供方</h2>
                  <p>查看各槽位实际使用的 Provider 与来源。</p>
                </div>
                <span className="plugins-section-label">PROVIDERS</span>
              </div>
              {snapshot?.providers.length ? (
                <div className="plugins-provider-grid">
                  {snapshot.providers.map((provider) => (
                    <div className="plugins-provider" key={provider.slot}>
                      <span>{slots.find((item) => item.value === provider.slot)?.label}</span>
                      <strong title={provider.name}>{provider.name}</strong>
                      <span className={`plugins-source plugins-source-${provider.source}`}>
                        <i />
                        {sourceLabels[provider.source]}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="plugins-provider-empty">
                  {snapshot
                    ? '服务器当前未返回 Provider 信息。'
                    : '连接管理服务后，显示各槽位的实际提供方。'}
                </p>
              )}
            </section>

            <div className="plugins-workspace">
              <section
                className="plugins-registry plugins-panel"
                aria-labelledby="plugin-list-title"
                aria-busy={busy}
              >
                <div className="plugins-section-heading">
                  <div>
                    <h2 id="plugin-list-title">
                      已登记插件
                      {snapshot && <span className="plugins-count">{snapshot.plugins.length}</span>}
                    </h2>
                    <p>管理独立扩展与算法 Provider。</p>
                  </div>
                  <Puzzle size={19} />
                </div>
                {snapshot?.plugins.length ? (
                  <div className="plugins-list">
                    {snapshot.plugins.map((plugin) => (
                      <article className="plugins-card" key={plugin.id}>
                        <div className="plugins-card-title">
                          <h3>{plugin.name}</h3>
                          <span className={`plugins-status plugins-status-${plugin.status}`}>
                            <i />
                            {statusLabels[plugin.status]}
                          </span>
                        </div>
                        <div className="plugins-card-meta">
                          <span>
                            {plugin.kind === 'provider' ? `Provider · ${plugin.slot}` : '扩展插件'}
                          </span>
                          {plugin.kind === 'provider' &&
                            snapshot.providers.some(
                              (provider) => provider.pluginId === plugin.id,
                            ) && <span className="plugins-current">当前提供方</span>}
                        </div>
                        <p className="plugins-entry">
                          <span>入口</span>
                          <code>{plugin.entry}</code>
                        </p>
                        {plugin.error && (
                          <p className="plugins-card-error">
                            <CircleAlert size={14} />
                            <span>{plugin.error}</span>
                          </p>
                        )}
                        <div className="plugins-card-actions">
                          <button
                            className="plugins-button"
                            disabled={!canManage}
                            onClick={() =>
                              action(plugin.id, plugin.status === 'active' ? 'disable' : 'enable')
                            }
                          >
                            {plugin.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                            {plugin.status === 'active'
                              ? '停用'
                              : plugin.status === 'failed'
                                ? '重试启用'
                                : '启用'}
                          </button>
                          {plugin.status !== 'active' && plugin.enabled && (
                            <button
                              className="plugins-text-button"
                              disabled={!canManage}
                              onClick={() => action(plugin.id, 'disable')}
                            >
                              停用
                            </button>
                          )}
                          <button
                            className="plugins-text-button"
                            disabled={!canManage}
                            onClick={() => {
                              setConfigureId(plugin.id);
                              setReplacementConfig('{}');
                              setRemoveId(undefined);
                            }}
                          >
                            <Settings2 size={13} />
                            配置
                          </button>
                          <button
                            className="plugins-text-button plugins-remove"
                            disabled={!canManage}
                            onClick={() => setRemoveId(plugin.id)}
                          >
                            <Trash2 size={13} />
                            移除
                          </button>
                        </div>
                        {configureId === plugin.id && (
                          <form
                            className="plugins-config-editor"
                            onSubmit={(event) => configure(event, plugin.id)}
                          >
                            <label htmlFor={`config-${plugin.id}`}>替换插件参数（JSON 对象）</label>
                            <p>
                              已保存参数不会回传。请填写完整配置，提交会替换原参数；停用的插件将在下次启用时校验。
                            </p>
                            <textarea
                              id={`config-${plugin.id}`}
                              rows={5}
                              value={replacementConfig}
                              disabled={busy}
                              onChange={(event) => setReplacementConfig(event.target.value)}
                              spellCheck={false}
                            />
                            <div>
                              <button
                                type="button"
                                className="plugins-button"
                                disabled={busy}
                                onClick={() => setConfigureId(undefined)}
                              >
                                取消
                              </button>
                              <button
                                type="submit"
                                className="plugins-button plugins-button-primary"
                                disabled={!canManage}
                              >
                                保存配置
                              </button>
                            </div>
                          </form>
                        )}
                        {removeId === plugin.id && (
                          <div className="plugins-remove-confirm">
                            <p>
                              移除「{plugin.name}」的登记与已保存配置？服务器上的 JS 文件会保留。
                            </p>
                            <div>
                              <button
                                className="plugins-button"
                                disabled={busy}
                                onClick={() => setRemoveId(undefined)}
                              >
                                取消
                              </button>
                              <button
                                className="plugins-button plugins-button-danger"
                                disabled={!canManage}
                                onClick={() => action(plugin.id, 'remove')}
                              >
                                确认移除
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="plugins-empty">
                    <span className="plugins-empty-icon">
                      <Puzzle size={28} strokeWidth={1.4} />
                    </span>
                    <h3>{snapshot ? '还没有登记插件' : '准备好连接新的能力'}</h3>
                    <p>
                      {snapshot
                        ? '在右侧填写本地构建入口，登记你的第一个插件。'
                        : '连接管理服务，查看现有插件或登记本地插件。'}
                    </p>
                  </div>
                )}
                <div className="plugins-registry-footnote">
                  <ShieldCheck size={14} />
                  已保存的插件配置可能含有凭据，不在列表中返回。
                </div>
              </section>

              <section
                className="plugins-install plugins-panel"
                aria-labelledby="plugin-install-title"
              >
                <div className="plugins-section-heading">
                  <div>
                    <h2 id="plugin-install-title">
                      <PackagePlus size={18} />
                      登记本地插件
                    </h2>
                    <p>从服务器可访问的构建产物加载。</p>
                  </div>
                </div>
                <form onSubmit={install}>
                  <fieldset disabled={!canManage}>
                    <div className="plugins-field">
                      <label htmlFor="plugin-name">插件名称</label>
                      <input
                        id="plugin-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="例如：设备诊断扩展"
                        required
                        maxLength={80}
                      />
                    </div>
                    <div className="plugins-field">
                      <label htmlFor="plugin-entry">JS 入口路径</label>
                      <input
                        id="plugin-entry"
                        value={entry}
                        onChange={(event) => setEntry(event.target.value)}
                        placeholder="例如：F:\plugins\diagnostics\dist\index.js"
                        required
                        maxLength={2000}
                        spellCheck={false}
                        aria-describedby="plugin-entry-help"
                      />
                      <p id="plugin-entry-help">服务器本地绝对路径，支持 .js / .mjs / .cjs。</p>
                    </div>
                    <div className="plugins-field">
                      <label htmlFor="plugin-kind">插件类型</label>
                      <select
                        id="plugin-kind"
                        value={kind}
                        onChange={(event) =>
                          setKind(event.target.value as PluginInstallRequest['kind'])
                        }
                      >
                        <option value="extension">扩展插件</option>
                        <option value="provider">算法 Provider</option>
                      </select>
                    </div>
                    {kind === 'provider' && (
                      <div className="plugins-field">
                        <label htmlFor="plugin-slot">替换能力槽位</label>
                        <select
                          id="plugin-slot"
                          value={slot}
                          onChange={(event) => setSlot(event.target.value as PluginSlot)}
                        >
                          {slots.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <p>启用后由服务器切换到此 Provider，停用后恢复原提供方。</p>
                      </div>
                    )}
                    <div className="plugins-field">
                      <label htmlFor="plugin-config">
                        插件配置<span>选填 · JSON 对象</span>
                      </label>
                      <textarea
                        id="plugin-config"
                        rows={4}
                        value={config}
                        onChange={(event) => setConfig(event.target.value)}
                        placeholder={'{\n  "timeout": 30000\n}'}
                        spellCheck={false}
                        aria-describedby="plugin-config-help"
                      />
                      <p id="plugin-config-help">配置交给插件使用，登记后不会在列表中显示。</p>
                    </div>
                    <label className="plugins-toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                      />
                      <span>
                        <strong>登记后立即启用</strong>
                        <small>关闭后仅保存登记，稍后可手动启用。</small>
                      </span>
                    </label>
                    <button
                      className="plugins-button plugins-button-primary plugins-submit"
                      type="submit"
                      disabled={!canManage || !name.trim() || !entry.trim()}
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="spinner" />
                      ) : (
                        <PackagePlus size={16} />
                      )}
                      登记插件
                    </button>
                  </fieldset>
                  {!token && (
                    <p className="plugins-form-hint">
                      先连接平台维护人员 Token，即可登记和管理插件。
                    </p>
                  )}
                </form>
                <div className="plugins-install-note">
                  <strong>独立构建，本地加载</strong>
                  <p>
                    插件项目自行构建 JS；服务器会执行你信任的本地代码。这里不上传源码、不下载 npm
                    包，也不运行构建。
                  </p>
                  <p>修改插件构建产物后需重启服务器，启停操作不会热更新源码。</p>
                </div>
              </section>
            </div>
          </>
        )}
        <footer className="plugins-footer">
          <ShieldCheck size={16} />
          <span>Harness Ops · 仅供受信任的平台维护人员使用</span>
        </footer>
      </main>
    </div>
  );
}
