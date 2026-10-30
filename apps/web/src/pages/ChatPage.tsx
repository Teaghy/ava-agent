import { CitationPanel } from '../components/citation/CitationPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  KeyRound,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  X,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import { Brand } from '../components/Brand';
import { Message } from '../components/message/Message';
import { Settings } from '../components/chat/Settings';
import { presetCopy } from '../lib/presets';
import {
  deleteConversation,
  loadClientConfig,
  loadConversations,
  loadHistory,
  sendMessage,
} from '../services/api';
import { readToken, saveToken } from '../services/token';
import {
  type ChatMessage,
  type Citation,
  type ClientConfig,
  type Conversation,
} from '../lib/protocol';

const newId = () => crypto.randomUUID();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '连接出现问题，请稍后重试。';
export function ChatPage() {
  const [config, setConfig] = useState<ClientConfig>();
  const [connectError, setConnectError] = useState('');
  const [reload, setReload] = useState(0);
  const [token, setToken] = useState(readToken);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState('');
  const [conversationId, setConversationId] = useState<string>(newId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [notice, setNotice] = useState('');
  const [sources, setSources] = useState<Citation[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deletingId, setDeletingId] = useState('');
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const identityVersion = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const connected = !!config && (!config.authRequired || !!token);
  const maxLength = config?.maxMessageLength ?? 2000;
  const copy = presetCopy[config?.preset ?? 'customer-service'];

  useEffect(() => {
    document.title = `Ava · ${copy.label}`;
  }, [copy.label]);
  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);

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
  }, [messages]);
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
    setDeleteTarget(null);
    setSidebarOpen(false);
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
    if (
      !message ||
      busy ||
      loadingHistory ||
      deletingId === conversationId ||
      !connected ||
      message.length > maxLength
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    const id = newId();
    const requestStartedAt = performance.now();
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
        requestStartedAt,
        progress: '正在理解你的问题',
      },
    ]);
    setDraft('');
    setBusy(true);
    setNotice('');
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
            update({ progress: event.data.phase === 'answer' ? '正在生成回答' : '正在整理信息' });
            break;
          case 'tool.started':
            update({
              progress: event.data.tool.includes('search')
                ? '正在查找相关知识'
                : '正在查询服务信息',
            });
            break;
          case 'rag.started':
            update({ progress: '正在检索知识库' });
            break;
          case 'rag.completed':
            update({
              progress: event.data.count
                ? `找到 ${event.data.count} 条相关资料，正在组织回答`
                : '正在确认是否需要补充信息',
            });
            break;
          case 'answer.delta':
            setMessages((previous) =>
              previous.map((m) =>
                m.id === id ? { ...m, content: m.content + event.data.text } : m,
              ),
            );
            update({ progress: '正在输出回答' });
            break;
          case 'answer.completed':
            update({
              content: event.data.answer,
              citations: event.data.citations,
              runId: event.data.runId,
              state: 'complete',
              durationMs: performance.now() - requestStartedAt,
            });
            break;
        }
      });
    } catch (error) {
      update({
        durationMs: performance.now() - requestStartedAt,
        ...(controller.signal.aborted
          ? { state: 'stopped' }
          : { state: 'failed', error: errorText(error) }),
      });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
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
    if (!saveToken(value)) setNotice('浏览器无法保存会话凭证，刷新后需要重新填写 Token。');
    if (value === token) void refresh();
  };
  const removeConversation = async () => {
    if (!deleteTarget || deletingId || (busy && deleteTarget.id === conversationId)) return;
    const version = identityVersion.current;
    const id = deleteTarget.id;
    setDeletingId(id);
    try {
      await deleteConversation(id, token);
      if (version !== identityVersion.current) return;
      identityVersion.current++;
      if (id === conversationId) reset();
      setConversations((previous) => previous.filter((item) => item.id !== id));
      setDeleteTarget(null);
      setNotice('对话已删除。');
      void refresh();
    } catch (error) {
      if (version === identityVersion.current) {
        setDeleteTarget(null);
        setNotice(errorText(error));
      }
    } finally {
      setDeletingId('');
    }
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
        <a className="wordmark" href="/" aria-label={`Ava ${copy.label}首页`}>
          <Brand />
          <span>
            ava<span className="wordmark-dot">.</span>
          </span>
          <span className="wordmark-caption">{copy.label}</span>
        </a>
        <button className="new-chat-button" onClick={reset} disabled={!!deletingId}>
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
              <div
                key={c.id}
                className={`history-row ${c.id === conversationId ? 'selected' : ''}`}
              >
                <button
                  className="history-item"
                  onClick={() => void openConversation(c.id)}
                  disabled={!!deletingId}
                  title={c.title}
                >
                  <MessageSquare size={15} />
                  <span>{c.title}</span>
                  {c.id === conversationId && <span className="selected-dot" />}
                </button>
                <button
                  type="button"
                  className="icon-button history-delete"
                  aria-label={`删除对话：${c.title}`}
                  title={busy && c.id === conversationId ? '请先停止生成再删除' : '删除对话'}
                  disabled={!!deletingId || (busy && c.id === conversationId)}
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
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
            <strong>{copy.label}工作空间</strong>
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
            <span className="topbar-title">
              {messages.length ? currentTitle : `Ava ${copy.label}`}
            </span>
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
                  <span className="eyebrow welcome-eyebrow">AVA ASSISTANT</span>
                  <h1>
                    你好，我是 Ava<span>{copy.tagline}</span>
                  </h1>
                  <p className="welcome-description">{copy.description}</p>
                  <div className="starter-grid">
                    {copy.starters.map(({ icon: Icon, title, text, query }) => (
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
                    {copy.trust[0]}
                    <span>·</span>
                    {copy.trust[1]}
                  </div>
                </section>
              ) : (
                <section className="messages" aria-label="聊天记录">
                  {messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      onSources={setSources}
                      assistantLabel={copy.label}
                    />
                  ))}
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
                  disabled={loadingHistory || deletingId === conversationId}
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
                  placeholder={copy.placeholder}
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
                        disabled={
                          !draft.trim() ||
                          !connected ||
                          loadingHistory ||
                          deletingId === conversationId
                        }
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
                {config?.mode === 'mock' ? copy.demoHint : copy.footnote}
                <span>Shift + Enter 换行</span>
              </p>
            </div>
          </div>
          {sources && <CitationPanel sources={sources} onClose={() => setSources(null)} />}
        </div>
      </main>
      <dialog
        ref={deleteDialog}
        className="settings-dialog conversation-delete-dialog"
        aria-labelledby="delete-conversation-title"
        onClose={() => setDeleteTarget(null)}
        onCancel={(event) => {
          if (deletingId) event.preventDefault();
          else setDeleteTarget(null);
        }}
      >
        <div className="dialog-heading">
          <h2 id="delete-conversation-title">删除这段对话？</h2>
        </div>
        <p className="delete-conversation-name">{deleteTarget?.title}</p>
        <p className="settings-note">
          聊天消息和摘要将被清除，删除后无法恢复。维护审计记录仍按系统策略保留。
        </p>
        <div className="dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={!!deletingId}
            onClick={() => setDeleteTarget(null)}
          >
            取消
          </button>
          <button
            type="button"
            className="primary-button delete-conversation-confirm"
            disabled={!!deletingId || (busy && deleteTarget?.id === conversationId)}
            onClick={() => void removeConversation()}
          >
            {deletingId ? '正在删除…' : '确认删除'}
          </button>
        </div>
      </dialog>
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
