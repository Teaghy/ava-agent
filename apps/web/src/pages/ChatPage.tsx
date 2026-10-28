import { CitationPanel } from '../components/citation/CitationPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  KeyRound,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Wrench,
  X,
  LoaderCircle,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { Message } from '../components/message/Message';
import { Settings } from '../components/chat/Settings';
import { loadClientConfig, loadConversations, loadHistory, sendMessage } from '../services/api';
import {
  type ChatMessage,
  type Citation,
  type ClientConfig,
  type Conversation,
} from '../lib/protocol';

const starters = [
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
];
const newId = () => crypto.randomUUID();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '连接出现问题，请稍后重试。';
export function ChatPage() {
  const [config, setConfig] = useState<ClientConfig>();
  const [connectError, setConnectError] = useState('');
  const [reload, setReload] = useState(0);
  const [token, setToken] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [conversationId, setConversationId] = useState<string>(newId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [sources, setSources] = useState<Citation[] | null>(null);
  const active = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const identityVersion = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const connected = !!config && (!config.authRequired || !!token);
  const maxLength = config?.maxMessageLength ?? 2000;

  useEffect(() => {
    const controller = new AbortController();
    setConnectError('');
    void loadClientConfig(controller.signal)
      .then(setConfig)
      .catch((error) => {
        if (!controller.signal.aborted) setConnectError(errorText(error));
      });
    return () => controller.abort();
  }, [reload]);
  const refresh = useCallback(async () => {
    if (!config || (config.authRequired && !token)) return;
    const version = identityVersion.current;
    try {
      const list = await loadConversations(token);
      if (version === identityVersion.current) setConversations(list);
    } catch (error) {
      if (version === identityVersion.current) setNotice(errorText(error));
    }
  }, [config, token]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(
    () => () => {
      active.current?.abort();
      historyRequest.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!scroller.current) return;
    if (!messages.length) scroller.current.scrollTop = 0;
    else if (nearBottom.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, progress]);
  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
    }
  }, [draft]);

  const reset = () => {
    active.current?.abort();
    active.current = null;
    historyRequest.current?.abort();
    historyRequest.current = null;
    setConversationId(newId());
    setMessages([]);
    setDraft('');
    setBusy(false);
    setLoadingHistory(false);
    setSources(null);
    setNotice('');
    setSidebarOpen(false);
    setProgress('');
    textarea.current?.focus();
  };
  const openConversation = async (id: string) => {
    nearBottom.current = true;
    if (id === conversationId && !loadingHistory) {
      setSidebarOpen(false);
      return;
    }
    active.current?.abort();
    active.current = null;
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setConversationId(id);
    setMessages([]);
    setDraft('');
    setSources(null);
    setBusy(false);
    setProgress('');
    setLoadingHistory(true);
    setNotice('');
    setSidebarOpen(false);
    try {
      const result = await loadHistory(id, token, controller.signal);
      if (controller !== historyRequest.current) return;
      setMessages(result.messages);
      if (result.messages.length >= result.limit) setNotice('当前展示最近 100 条消息。');
    } catch (error) {
      if (!controller.signal.aborted) setNotice(errorText(error));
    } finally {
      if (controller === historyRequest.current) setLoadingHistory(false);
    }
  };
  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || loadingHistory || !connected || message.length > maxLength) return;
    const controller = new AbortController();
    active.current = controller;
    const id = newId();
    nearBottom.current = true;
    setMessages((previous) => [
      ...previous,
      { id: newId(), role: 'user', content: message, createdAt: new Date().toISOString() },
      {
        id,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        state: 'streaming',
      },
    ]);
    setDraft('');
    setBusy(true);
    setNotice('');
    setProgress('正在理解你的问题');
    setSources(null);
    const update = (change: Partial<ChatMessage>) =>
      setMessages((previous) => previous.map((m) => (m.id === id ? { ...m, ...change } : m)));
    try {
      await sendMessage(conversationId, message, token, controller.signal, (event) => {
        if (controller !== active.current) return;
        switch (event.type) {
          case 'agent.started':
            update({ runId: event.data.runId });
            break;
          case 'agent.step':
            setProgress('正在整理信息');
            break;
          case 'tool.started':
            setProgress(
              event.data.tool.includes('search') ? '正在查找相关知识' : '正在查询服务信息',
            );
            break;
          case 'rag.started':
            setProgress('正在检索设备知识库');
            break;
          case 'rag.completed':
            setProgress(
              event.data.count
                ? `找到 ${event.data.count} 条相关资料，正在组织回答`
                : '正在确认是否需要补充信息',
            );
            break;
          case 'answer.delta':
            setMessages((previous) =>
              previous.map((m) =>
                m.id === id ? { ...m, content: m.content + event.data.text } : m,
              ),
            );
            setProgress('正在生成回答');
            break;
          case 'answer.completed':
            update({
              content: event.data.answer,
              citations: event.data.citations,
              runId: event.data.runId,
              state: 'complete',
            });
            setProgress('');
            break;
        }
      });
    } catch (error) {
      update(
        controller.signal.aborted
          ? { state: 'stopped' }
          : { state: 'failed', error: errorText(error) },
      );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        setProgress('');
        void refresh();
        textarea.current?.focus();
      }
    }
  };
  const applyToken = (value: string) => {
    identityVersion.current++;
    reset();
    setConversations([]);
    setToken(value);
    if (value === token) void refresh();
  };
  const currentTitle =
    conversations.find((c) => c.id === conversationId)?.title ??
    (messages.find((m) => m.role === 'user')?.content || '新对话');
  const latestSources = messages.findLast((m) => m.citations?.length)?.citations ?? [];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#chat-input">
        跳到消息输入框
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭对话列表"
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="对话导航">
        <a className="wordmark" href="/" aria-label="Ava 智能客服首页">
          <Brand />
          <span>
            ava<span className="wordmark-dot">.</span>
          </span>
          <span className="wordmark-caption">智能客服</span>
        </a>
        <button className="new-chat-button" onClick={reset}>
          <Plus size={18} />
          开启新对话<span>↗</span>
        </button>
        <label className="history-search">
          <Search size={15} />
          <input
            aria-label="搜索对话"
            placeholder="搜索对话"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="history-heading">
          最近对话<span>{conversations.length || ''}</span>
        </div>
        <nav className="history-list" aria-label="最近对话">
          {conversations
            .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
            .map((c) => (
              <button
                key={c.id}
                className={`history-item ${c.id === conversationId ? 'selected' : ''}`}
                onClick={() => void openConversation(c.id)}
                title={c.title}
              >
                <MessageSquare size={15} />
                <span>{c.title}</span>
                {c.id === conversationId && <span className="selected-dot" />}
              </button>
            ))}
          {!conversations.length && (
            <p className="history-empty">
              {connected ? '每一次对话，都从这里开始。' : '连接服务后查看对话记录。'}
            </p>
          )}
          {conversations.length > 0 &&
            !conversations.some((c) => c.title.toLowerCase().includes(search.toLowerCase())) && (
              <p className="history-empty">没有找到匹配的对话。</p>
            )}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-icon">
            <ShieldCheck size={19} />
          </div>
          <div className="workspace-copy">
            <strong>客服工作空间</strong>
            <span>
              <i />
              {config ? '服务已连接' : '正在连接服务'}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="连接与服务设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开对话列表"
              aria-expanded={sidebarOpen}
            >
              <Menu size={20} />
            </button>
            <span className="topbar-title">{messages.length ? currentTitle : 'Ava 客服助手'}</span>
            <span className="mode-badge">
              <i />
              {config?.mode === 'live' ? '在线服务' : '演示模式'}
            </span>
          </div>
          <button
            className="sources-toggle"
            onClick={() => setSources(sources ? null : latestSources)}
            aria-expanded={!!sources}
          >
            <BookOpen size={16} />
            <span>知识来源</span>
          </button>
        </header>
        {connectError && (
          <div className="connection-banner" role="alert">
            无法连接服务：{connectError}
            <button onClick={() => setReload((n) => n + 1)}>重新连接</button>
          </div>
        )}
        {config?.authRequired && !token && (
          <div className="connection-banner">
            <KeyRound size={16} />
            此服务需要访问 Token。
            <button onClick={() => setSettingsOpen(true)}>
              连接服务
              <ArrowUpRight size={13} />
            </button>
          </div>
        )}
        <div className="chat-layout">
          <div className="chat-column">
            <div
              className="chat-scroller"
              ref={scroller}
              onScroll={() => {
                const el = scroller.current;
                if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {loadingHistory ? (
                <div className="history-loading" role="status">
                  <LoaderCircle className="spinner" size={20} />
                  正在读取对话…
                </div>
              ) : !messages.length ? (
                <section className="welcome">
                  <div className="welcome-symbol">
                    <Brand />
                    <span className="welcome-spark">✳</span>
                  </div>
                  <span className="eyebrow welcome-eyebrow">YOUR EVERYDAY SUPPORT</span>
                  <h1>
                    你好，我是 Ava<span>设备问题，我们一起解决。</span>
                  </h1>
                  <p className="welcome-description">
                    从一个故障现象开始，我会帮你查找知识、梳理原因，
                    <br className="desktop-break" />
                    找到有据可循的解决方法。
                  </p>
                  <div className="starter-grid">
                    {starters.map(({ icon: Icon, title, text, query }) => (
                      <button
                        key={title}
                        className="starter-card"
                        onClick={() => void send(query)}
                        disabled={!connected}
                      >
                        <Icon size={19} />
                        <strong>
                          {title}
                          <ArrowUpRight size={15} />
                        </strong>
                        <span>{text}</span>
                      </button>
                    ))}
                  </div>
                  <div className="welcome-trust">
                    <ShieldCheck size={14} />
                    基于知识库回答<span>·</span>参考来源可追溯
                  </div>
                </section>
              ) : (
                <section className="messages" aria-label="聊天记录">
                  {messages.map((message) => (
                    <Message key={message.id} message={message} onSources={setSources} />
                  ))}
                  <div className="progress-line" role="status" aria-live="polite">
                    {busy && (
                      <>
                        <span className="progress-dot" />
                        {progress}
                      </>
                    )}
                  </div>
                </section>
              )}
            </div>
            <div className="composer-area">
              {notice && (
                <div className="notice" role="status">
                  {notice}
                  <button
                    className="icon-button"
                    onClick={() => setNotice('')}
                    aria-label="关闭提示"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void send(draft);
                }}
              >
                <label className="sr-only" htmlFor="chat-input">
                  输入你的问题
                </label>
                <textarea
                  id="chat-input"
                  ref={textarea}
                  rows={2}
                  value={draft}
                  disabled={loadingHistory}
                  maxLength={maxLength}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      if (!busy) void send(draft);
                    }
                  }}
                  placeholder="描述设备型号、故障现象，或你想了解的问题…"
                />
                <div className="composer-toolbar">
                  <span className="composer-hint">
                    <span className="input-dot" />
                    {busy ? 'Ava 正在为你查找答案' : '有问题，随时问 Ava'}
                  </span>
                  <div className="composer-controls">
                    <span
                      className={`character-count ${draft.length >= maxLength ? 'at-limit' : ''}`}
                    >
                      {draft.length > 0 ? `${draft.length} / ${maxLength}` : 'Enter 发送'}
                    </span>
                    {busy ? (
                      <button
                        type="button"
                        className="send-button stop-button"
                        onClick={() => active.current?.abort()}
                        aria-label="停止生成"
                        title="停止生成"
                      >
                        <Square size={15} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!draft.trim() || !connected || loadingHistory}
                        aria-label="发送消息"
                        title="发送消息"
                      >
                        <ArrowUp size={20} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              <p className="composer-footnote">
                {config?.mode === 'mock'
                  ? '当前为演示模式 · 试试 VCD-2000 的 E102 故障排查'
                  : 'Ava 的回答供参考，设备操作请遵循官方安全规程。'}
                <span>Shift + Enter 换行</span>
              </p>
            </div>
          </div>
          {sources && <CitationPanel sources={sources} onClose={() => setSources(null)} />}
        </div>
      </main>
      <Settings
        open={settingsOpen}
        config={config}
        token={token}
        onClose={() => setSettingsOpen(false)}
        onApply={applyToken}
      />
    </div>
  );
}
