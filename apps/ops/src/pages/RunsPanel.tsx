import { useEffect, useState, type FormEvent } from 'react';
import { AgentClient } from '@ava/sdk';
import type { RunDetail, RunEvent, RunListRequest, RunSummary } from '@ava/protocol';
import { Activity, ArrowLeft, ArrowRight, Clock3, RefreshCw, Search } from 'lucide-react';
import './runs.css';

const statuses = {
  running: '执行中',
  waiting_tool: '等待工具',
  completed: '已完成',
  failed: '失败',
};
const labels: Record<string, string> = {
  user_message: '收到问题',
  agent_decision: 'Agent 决策',
  tool_call: '调用工具',
  tool_result: '工具结果',
  rag_search: '知识检索',
  rag_result: '检索结果',
  memory_read: '读取记忆',
  memory_write: '写入记忆',
  assistant_message: '生成回答',
  checkpoint: '保存状态',
  error: '执行失败',
  execution_span: '答案校验',
};
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const elapsed = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
function data(event: RunEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '查询失败，请稍后重试。';

export function RunsPanel({ token }: { token: string }) {
  const [tenants, setTenants] = useState<string[]>([]);
  const [tenant, setTenant] = useState('');
  const [status, setStatus] = useState('');
  const [runId, setRunId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [query, setQuery] = useState<RunListRequest>();
  const [rows, setRows] = useState<RunSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<RunSummary>();
  const [detail, setDetail] = useState<RunDetail>();
  const [node, setNode] = useState('');
  const [checkpoints, setCheckpoints] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!token) return;
    setError('');
    void new AgentClient({ token }).runs
      .access(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setTenants(result.tenantIds);
        const first = result.tenantIds[0] ?? '';
        setTenant(first);
        if (first) setQuery({ tenantId: first, limit: 30, offset: 0 });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!query || !token) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setRows([]);
    setHasMore(false);
    void new AgentClient({ token }).runs
      .list(query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRows(result.runs);
          setHasMore(result.hasMore);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, token, refresh]);

  useEffect(() => {
    if (!selected || !token) return;
    const controller = new AbortController();
    setDetail(undefined);
    setDetailError('');
    setDetailLoading(true);
    setNode('');
    void new AgentClient({ token }).runs
      .get({ tenantId: selected.tenantId, runId: selected.runId }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDetail(result);
        setNode(
          result.events.findLast((e) => e.type === 'error')?.id ??
            result.events.find((e) => e.type !== 'checkpoint')?.id ??
            '',
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setDetailError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selected, token, refresh]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!tenant) return;
    setSelected(undefined);
    setDetail(undefined);
    setQuery({
      tenantId: tenant,
      limit: 30,
      offset: 0,
      ...(status ? { status: status as RunSummary['status'] } : {}),
      ...(runId.trim() ? { runId: runId.trim() } : {}),
      ...(conversationId.trim() ? { conversationId: conversationId.trim() } : {}),
      ...(since ? { since: new Date(since).toISOString() } : {}),
      ...(until ? { until: new Date(until).toISOString() } : {}),
    });
  };
  const events =
    detail?.events.filter(
      (e) =>
        (checkpoints || e.type !== 'checkpoint') &&
        !(e.type === 'execution_span' && data(e).phase === 'decision'),
    ) ?? [];
  const current = events.find((e) => e.id === node);
  const duration = (event: RunEvent) => {
    let value = data(event).durationMs;
    if (event.type === 'agent_decision' && detail) {
      const next = detail.events[detail.events.findIndex((e) => e.id === event.id) + 1];
      if (next?.type === 'execution_span' && data(next).phase === 'decision')
        value = data(next).durationMs;
    }
    return typeof value === 'number' ? elapsed(value) : undefined;
  };

  if (!token)
    return (
      <section className="plugins-panel runs-empty">
        <Activity size={28} />
        <h2>连接后查看运行轨迹</h2>
        <p>使用上方维护 Token 连接，查询每次提问的执行记录。</p>
      </section>
    );
  return (
    <section className="runs-panel" aria-label="运行排查">
      <form className="plugins-panel runs-filters" onSubmit={search}>
        <label>
          租户
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          运行状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          运行 ID
          <input
            placeholder="精确匹配 runId"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
          />
        </label>
        <label>
          会话 ID
          <input
            placeholder="精确匹配会话"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
          />
        </label>
        <label>
          开始时间
          <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label>
          结束时间
          <input
            type="datetime-local"
            value={until}
            min={since || undefined}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
        <div className="runs-filter-actions">
          <button className="plugins-button plugins-button-primary" disabled={loading || !tenant}>
            <Search size={15} />
            查询
          </button>
          <button
            className="plugins-button"
            type="button"
            disabled={loading || !query}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      </form>
      {error && (
        <p className="plugins-feedback plugins-feedback-error" role="alert">
          {error}
        </p>
      )}
      <div className="runs-workspace">
        <section className="plugins-panel runs-list" aria-label="运行列表" aria-busy={loading}>
          <div className="plugins-section-heading">
            <h2>
              运行记录 <span className="plugins-count">{rows.length}</span>
            </h2>
            <Activity size={18} />
          </div>
          {loading ? (
            <p className="runs-empty" role="status">
              正在读取运行记录…
            </p>
          ) : !rows.length ? (
            <div className="runs-empty">
              <h3>没有匹配的运行</h3>
              <p>调整查询条件，或在聊天端发起一次请求。这里只显示已持久化的运行。</p>
            </div>
          ) : (
            <div className="runs-rows">
              {rows.map((row) => (
                <button
                  key={row.runId}
                  className={`runs-row ${selected?.runId === row.runId ? 'is-selected' : ''}`}
                  aria-pressed={selected?.runId === row.runId}
                  onClick={() => setSelected(row)}
                >
                  <span className="runs-row-meta">
                    <span className={`runs-status ${row.status}`}>{statuses[row.status]}</span>
                    <time>{date(row.createdAt)}</time>
                  </span>
                  <strong>{row.question || '未记录问题内容'}</strong>
                  <code>{row.runId}</code>
                  <span className="runs-row-meta">
                    <span>{row.userId || '未知用户'}</span>
                    <span>{row.step} 步</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="runs-pagination">
            <button
              className="plugins-button"
              disabled={loading || !query?.offset}
              onClick={() =>
                setQuery((q) => q && { ...q, offset: Math.max(0, (q.offset ?? 0) - 30) })
              }
            >
              <ArrowLeft size={14} />
              上一页
            </button>
            <span>第 {Math.floor((query?.offset ?? 0) / 30) + 1} 页</span>
            <button
              className="plugins-button"
              disabled={loading || !hasMore}
              onClick={() => setQuery((q) => q && { ...q, offset: (q.offset ?? 0) + 30 })}
            >
              下一页
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section
          className="plugins-panel runs-detail"
          aria-label="运行详情"
          aria-busy={detailLoading}
        >
          {!selected ? (
            <div className="runs-empty runs-placeholder">
              <Activity size={32} />
              <h2>选择一次运行</h2>
              <p>查看执行路径、工具结果和失败位置。</p>
            </div>
          ) : detailLoading ? (
            <p className="runs-empty" role="status">
              正在读取执行轨迹…
            </p>
          ) : detailError ? (
            <p className="plugins-feedback plugins-feedback-error" role="alert">
              {detailError}
            </p>
          ) : (
            detail && (
              <>
                <div className="runs-detail-heading">
                  <span className={`runs-status ${detail.run.status}`}>
                    {statuses[detail.run.status]}
                  </span>
                  <h2>{detail.run.question || '运行详情'}</h2>
                  <dl>
                    <dt>运行</dt>
                    <dd>{detail.run.runId}</dd>
                    <dt>会话</dt>
                    <dd>{detail.run.conversationId}</dd>
                    <dt>租户 / 用户</dt>
                    <dd>
                      {detail.run.tenantId} / {detail.run.userId}
                    </dd>
                  </dl>
                  <p>
                    <Clock3 size={14} />
                    记录跨度{' '}
                    {elapsed(
                      Math.max(
                        0,
                        Date.parse(detail.run.updatedAt) - Date.parse(detail.run.createdAt),
                      ),
                    )}{' '}
                    · 最近事件 {date(detail.run.updatedAt)}
                  </p>
                </div>
                <div className="runs-trace-heading">
                  <h3>执行轨迹</h3>
                  <label>
                    <input
                      type="checkbox"
                      checked={checkpoints}
                      onChange={(e) => {
                        setCheckpoints(e.target.checked);
                        setNode('');
                      }}
                    />
                    显示状态快照
                  </label>
                </div>
                <div className="runs-trace-layout">
                  <ol className="runs-trace">
                    {events.map((event, index) => {
                      const payload = data(event);
                      const failed = event.type === 'error' || payload.status === 'failed';
                      return (
                        <li key={event.id} className={failed ? 'is-failed' : ''}>
                          <button
                            className={`runs-node ${node === event.id ? 'is-selected' : ''}`}
                            aria-pressed={node === event.id}
                            onClick={() => setNode(event.id)}
                          >
                            <span className="runs-node-number">{index + 1}</span>
                            <span>
                              <strong>{labels[event.type] ?? event.type}</strong>
                              {typeof payload.tool === 'string' && <code>{payload.tool}</code>}
                              <small>
                                {new Date(event.createdAt).toLocaleTimeString('zh-CN', {
                                  hour12: false,
                                })}
                                {duration(event) ? ` · ${duration(event)}` : ''}
                              </small>
                            </span>
                            {failed && <span className="runs-failure">失败</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="runs-node-detail" aria-live="polite">
                    {current ? (
                      <>
                        <h3>{labels[current.type] ?? current.type}</h3>
                        <p>
                          {date(current.createdAt)}
                          {duration(current) ? ` · 耗时 ${duration(current)}` : ''}
                        </p>
                        <pre tabIndex={0} aria-label="节点数据">
                          {JSON.stringify(current.payload, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <p>点击一个节点查看详情。</p>
                    )}
                  </div>
                </div>
                <p className="runs-note">
                  按实际事件顺序展示；旧记录可能没有节点耗时。运行中状态是最后保存的状态，进程中断后可能尚未更新。常见凭据字段已过滤，业务内容仅供授权维护人员排查。
                </p>
              </>
            )
          )}
        </section>
      </div>
    </section>
  );
}
