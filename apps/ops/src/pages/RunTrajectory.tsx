import { useId, useMemo, useState } from 'react';
import type { RunDetail } from '@ava/protocol';
import { ChevronDown, Clock3, Columns3, Search, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import {
  projectTrace,
  groupTrace,
  timelineDomain,
  traceElapsed,
  traceLanes,
  type TraceRecord,
} from './trace-projection';
import './run-trajectory.css';

const recordedTime = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '时间未记录';
export function RunTrajectory({
  detail,
  checkpoints,
  selectedId,
  onSelect,
}: {
  detail: RunDetail;
  checkpoints: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const records = useMemo(() => projectTrace(detail, checkpoints), [detail, checkpoints]);
  const [mode, setMode] = useState<'sequence' | 'time'>('sequence');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const normalized = query.trim().toLocaleLowerCase();
  const matching = records.filter(
    (record) => !normalized || record.searchText.includes(normalized),
  );
  const matchIds = new Set(matching.map((record) => record.event.id));
  const selected = records.find((record) => record.event.id === selectedId);
  const domain = timelineDomain(records, mode);
  const groups = groupTrace(matching);
  const unknownTimes = records.filter((record) => record.start === undefined).length;
  const groupTitle = (step: number) => (step === 0 ? '准备与上下文' : `第 ${step} 步`);
  const select = (record: TraceRecord, reveal = false) => {
    if (normalized && !matchIds.has(record.event.id)) setQuery('');
    setCollapsed((previous) => new Set([...previous].filter((step) => step !== record.step)));
    onSelect(record.event.id);
    if (reveal)
      requestAnimationFrame(() =>
        document
          .getElementById(`${id}-${record.event.id}`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
      );
  };
  const toggle = (step: number) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  return (
    <div className="trajectory-view" aria-label="三泳道轨迹图">
      <div className="trajectory-toolbar">
        <div className="trajectory-mode" aria-label="轨迹排列方式">
          <button
            type="button"
            aria-pressed={mode === 'sequence'}
            onClick={() => {
              setMode('sequence');
              setZoom(1);
            }}
          >
            <Columns3 size={13} />
            顺序
          </button>
          <button
            type="button"
            aria-pressed={mode === 'time'}
            onClick={() => {
              setMode('time');
              setZoom(1);
            }}
            disabled={!timelineDomain(records, 'time')}
          >
            <Clock3 size={13} />
            按耗时
          </button>
        </div>
        <div className="trajectory-zoom" aria-label="时间概览缩放">
          <button
            type="button"
            title="缩小轨迹图"
            aria-label="缩小轨迹图"
            disabled={zoom === 1}
            onClick={() => setZoom((value) => Math.max(1, value - 1))}
          >
            <ZoomOut size={14} />
          </button>
          <span>{zoom * 100}%</span>
          <button
            type="button"
            title="放大轨迹图"
            aria-label="放大轨迹图"
            disabled={zoom === 4}
            onClick={() => setZoom((value) => Math.min(4, value + 1))}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            title="重置轨迹图缩放"
            aria-label="重置轨迹图缩放"
            disabled={zoom === 1}
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <label className="trajectory-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索轨迹记录"
            placeholder="搜索事件、工具或错误…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" aria-label="清空轨迹搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div
        className="trajectory-overview"
        aria-label={mode === 'time' ? '记录时间与耗时概览' : '事件顺序概览'}
      >
        <div className="trajectory-lane-labels" aria-hidden="true">
          {traceLanes.map((lane) => (
            <span key={lane.id}>{lane.label}</span>
          ))}
          <span>{mode === 'time' ? '相对时间' : '记录序号'}</span>
        </div>
        <div
          className="trajectory-overview-scroll"
          tabIndex={0}
          aria-label="轨迹时间概览，可横向滚动"
        >
          <div className="trajectory-overview-content" style={{ width: `${zoom * 100}%` }}>
            {traceLanes.map((lane) => (
              <div className={`trajectory-lane trajectory-lane-${lane.id}`} key={lane.id}>
                {domain &&
                  records
                    .filter(
                      (record) =>
                        record.lane === lane.id &&
                        (mode === 'sequence' || record.start !== undefined),
                    )
                    .map((record) => {
                      const span = domain.end - domain.start;
                      const start = mode === 'sequence' ? record.index - 1 : record.start!;
                      const end = mode === 'sequence' ? record.index : record.end!;
                      const left = Math.max(0, ((start - domain.start) / span) * 100);
                      const width = Math.max(0, ((end - start) / span) * 100);
                      const duration =
                        record.durationMs === undefined
                          ? '未记录耗时'
                          : traceElapsed(record.durationMs);
                      return (
                        <button
                          key={record.event.id}
                          type="button"
                          aria-label={`定位记录 ${record.index}，${record.label}，${duration}`}
                          title={`#${record.index} ${record.label} · ${duration}`}
                          aria-pressed={selectedId === record.event.id}
                          className={`trajectory-span ${record.failed ? 'is-failed' : ''} ${selectedId === record.event.id ? 'is-selected' : ''} ${normalized && !matchIds.has(record.event.id) ? 'is-dimmed' : ''}`}
                          style={{ left: `${Math.min(left, 99.5)}%`, width: `max(3px, ${width}%)` }}
                          onClick={() => select(record, true)}
                        />
                      );
                    })}
              </div>
            ))}
            <div className="trajectory-axis" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <span key={fraction} style={{ left: `${fraction * 100}%` }}>
                  {mode === 'sequence'
                    ? `#${Math.max(1, Math.round(fraction * records.length))}`
                    : domain
                      ? traceElapsed((domain.end - domain.start) * fraction)
                      : '—'}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="trajectory-ledger-toolbar">
        <span role="status">
          {normalized
            ? `匹配 ${matching.length} / ${records.length} 条记录`
            : `${records.length} 条记录`}{' '}
          · {records.filter((record) => record.failed).length} 个异常节点
        </span>
        <button
          type="button"
          disabled={!!normalized || !groups.length}
          onClick={() =>
            setCollapsed(collapsed.size ? new Set() : new Set(groups.map((group) => group.step)))
          }
        >
          {collapsed.size ? '展开全部步骤' : '折叠全部步骤'}
        </button>
      </div>
      {mode === 'time' && (
        <p className="trajectory-timing-note">
          条形由事件时间及已记录耗时回推；未记录耗时的事件显示为时间点，空白保留记录间隔。
          {unknownTimes > 0 && `${unknownTimes} 条缺少有效时间的记录仅在下表展示。`}
        </p>
      )}
      <div
        className="trajectory-ledger-scroll"
        tabIndex={0}
        aria-label="三泳道轨迹记录，可横向和纵向滚动"
      >
        <table className="trajectory-ledger">
          <caption className="overview-sr-only">按执行步骤排列的输入、模型与工具记录</caption>
          <thead>
            <tr>
              {traceLanes.map((lane) => (
                <th key={lane.id} scope="col">
                  <i className={`trajectory-dot trajectory-dot-${lane.id}`} />
                  {lane.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ step, records: group }, groupIndex) => (
            <tbody key={`${step}-${groupIndex}`}>
              <tr className="trajectory-step">
                <th colSpan={3}>
                  <button
                    type="button"
                    aria-expanded={!!normalized || !collapsed.has(step)}
                    onClick={() => toggle(step)}
                    disabled={!!normalized}
                  >
                    <ChevronDown
                      size={13}
                      className={!normalized && collapsed.has(step) ? 'is-collapsed' : ''}
                    />
                    <strong>{groupTitle(step)}</strong>
                    <span>{group.length} 条记录</span>
                  </button>
                </th>
              </tr>
              {(normalized || !collapsed.has(step)) &&
                group.map((record) => (
                  <tr
                    key={record.event.id}
                    id={`${id}-${record.event.id}`}
                    className={`${selectedId === record.event.id ? 'is-selected' : ''} ${record.failed ? 'is-failed' : ''}`}
                  >
                    {traceLanes.map((lane) => (
                      <td key={lane.id} className={`trajectory-cell-${lane.id}`}>
                        {record.lane === lane.id && (
                          <button
                            type="button"
                            className="trajectory-record"
                            aria-pressed={selectedId === record.event.id}
                            onClick={() => select(record)}
                          >
                            <span className="trajectory-record-title">
                              <span className="trajectory-record-index">#{record.index}</span>
                              <strong>{record.label}</strong>
                              {record.failed && (
                                <span className="trajectory-record-error">失败</span>
                              )}
                            </span>
                            <span className="trajectory-record-preview">{record.preview}</span>
                            <span className="trajectory-record-meta">
                              <time>
                                {Number.isFinite(Date.parse(record.event.createdAt))
                                  ? new Date(record.event.createdAt).toLocaleTimeString('zh-CN', {
                                      hour12: false,
                                    })
                                  : '时间未记录'}
                              </time>
                              <span>
                                {record.durationMs === undefined
                                  ? '耗时 —'
                                  : traceElapsed(record.durationMs)}
                              </span>
                            </span>
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
        {!matching.length && (
          <p className="trajectory-empty">
            {records.length
              ? '没有匹配的记录，试试工具名、阶段或错误码。'
              : '本次运行还没有可展示的事件。'}
          </p>
        )}
      </div>
      <section className="trajectory-inspector" aria-label="轨迹图节点详情" aria-live="polite">
        {selected ? (
          <>
            <div className="trajectory-inspector-heading">
              <h4>
                #{selected.index} {selected.label}
              </h4>
              <span>
                {groupTitle(selected.step)} ·{' '}
                {traceLanes.find((lane) => lane.id === selected.lane)?.label}
              </span>
            </div>
            <p>
              {recordedTime(selected.event.createdAt)} ·{' '}
              {selected.durationMs === undefined
                ? '未记录节点耗时'
                : `耗时 ${traceElapsed(selected.durationMs)}`}
              {selected.firstTokenMs !== undefined &&
                ` · 首字 ${traceElapsed(selected.firstTokenMs)}`}
            </p>
            <pre tabIndex={0} aria-label="轨迹图节点数据">
              {JSON.stringify(selected.event.payload, null, 2)}
            </pre>
          </>
        ) : (
          <p>选择概览条形或表格记录，查看节点数据。</p>
        )}
      </section>
    </div>
  );
}
