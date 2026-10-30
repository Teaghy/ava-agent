import type { RunDetail, RunEvent } from '@ava/protocol';

export type TraceLane = 'input' | 'model' | 'tool';
export interface TraceRecord {
  event: RunEvent;
  index: number;
  step: number;
  lane: TraceLane;
  label: string;
  preview: string;
  failed: boolean;
  durationMs?: number;
  firstTokenMs?: number;
  start?: number;
  end?: number;
  searchText: string;
}
export const traceLanes = [
  { id: 'input', label: '输入与上下文' },
  { id: 'model', label: '模型' },
  { id: 'tool', label: '工具与检索' },
] as const;
export function tracePayload(event: RunEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const labels: Record<string, string> = {
  user_message: '用户输入',
  memory_read: '读取记忆',
  memory_write: '写入记忆',
  checkpoint: '状态快照',
  agent_decision: '模型决策',
  tool_call: '调用工具',
  tool_result: '工具结果',
  rag_search: '开始检索',
  rag_result: '检索结果',
  assistant_message: '最终回答',
  error: '执行失败',
};
function laneFor(event: RunEvent): TraceLane {
  const payload = tracePayload(event);
  if (['tool_call', 'tool_result', 'rag_search', 'rag_result'].includes(event.type)) return 'tool';
  if (event.type === 'error')
    return payload.phase === 'decision' || payload.phase === 'answer'
      ? 'model'
      : payload.phase === 'tool' || payload.phase === 'guard'
        ? 'tool'
        : 'input';
  if (event.type === 'execution_span')
    return payload.phase === 'guard' || payload.phase === 'tool'
      ? 'tool'
      : payload.phase === 'decision' || payload.phase === 'answer'
        ? 'model'
        : 'input';
  return event.type === 'agent_decision' || event.type === 'assistant_message' ? 'model' : 'input';
}
function labelFor(event: RunEvent) {
  const payload = tracePayload(event);
  if (event.type === 'execution_span')
    return payload.phase === 'answer'
      ? '正文生成'
      : payload.phase === 'guard'
        ? '答案校验'
        : payload.phase === 'decision'
          ? '决策耗时'
          : `执行阶段 · ${String(payload.phase ?? '未命名')}`;
  return labels[event.type] ?? event.type;
}
function previewFor(event: RunEvent): string {
  const payload = tracePayload(event);
  let text = '';
  if (event.type === 'memory_read' && Array.isArray(payload.ids))
    text = `召回 ${payload.ids.length} 条记忆`;
  else if (event.type === 'rag_result' && Array.isArray(payload.documents))
    text = `记录 ${payload.documents.length} 个知识分片`;
  else if (event.type === 'execution_span' && payload.phase === 'answer')
    text = `${payload.delivery === 'stream' ? '流式输出' : payload.delivery === 'buffered' ? '完整生成后输出' : '回答正文生成'}${finite(payload.outputChars) ? ` · ${payload.outputChars} 字符` : ''}`;
  else {
    const candidate =
      payload.message ??
      payload.content ??
      payload.answer ??
      payload.question ??
      payload.query ??
      payload.tool ??
      payload.code ??
      payload.type;
    text =
      typeof candidate === 'string'
        ? candidate
        : event.type === 'checkpoint'
          ? `保存运行状态${typeof payload.status === 'string' ? ` · ${payload.status}` : ''}`
          : event.type === 'execution_span'
            ? String(payload.outcome ?? '阶段记录')
            : '展开查看记录数据';
  }
  return text.replace(/\s+/g, ' ').slice(0, 220);
}

/** Preserve ledger order. Only an adjacent decision span is folded into its decision. */
export function projectTrace(detail: RunDetail, checkpoints = false): TraceRecord[] {
  const records: TraceRecord[] = [];
  let step = 0;
  for (let index = 0; index < detail.events.length; index++) {
    const event = detail.events[index]!;
    const payload = tracePayload(event);
    if (!checkpoints && event.type === 'checkpoint') continue;
    if (
      event.type === 'execution_span' &&
      payload.phase === 'decision' &&
      detail.events[index - 1]?.type === 'agent_decision'
    )
      continue;
    const next = detail.events[index + 1];
    const measured =
      event.type === 'agent_decision' &&
      next?.type === 'execution_span' &&
      tracePayload(next).phase === 'decision'
        ? next
        : event;
    const timing = tracePayload(measured);
    if (event.type === 'agent_decision')
      step =
        finite(timing.step) && Number.isInteger(timing.step) && timing.step > 0
          ? timing.step
          : step + 1;
    const recordStep =
      finite(payload.step) && Number.isInteger(payload.step) && event.type !== 'checkpoint'
        ? payload.step
        : step;
    if (recordStep > step) step = recordStep;
    const endTime = Date.parse(measured.createdAt);
    const durationMs = finite(timing.durationMs) ? timing.durationMs : undefined;
    const end = Number.isFinite(endTime) ? endTime : undefined;
    const start = end === undefined ? undefined : end - (durationMs ?? 0);
    const label = labelFor(event);
    const preview = previewFor(event);
    records.push({
      event,
      index: records.length + 1,
      step: recordStep,
      lane: laneFor(event),
      label,
      preview,
      failed: event.type === 'error' || payload.status === 'failed',
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(finite(timing.firstTokenMs) &&
      (durationMs === undefined || timing.firstTokenMs <= durationMs)
        ? { firstTokenMs: timing.firstTokenMs }
        : {}),
      ...(end === undefined ? {} : { start, end }),
      searchText:
        `${label} ${preview} ${event.type} ${JSON.stringify(event.payload)}`.toLocaleLowerCase(),
    });
  }
  return records;
}
export function timelineDomain(records: readonly TraceRecord[], mode: 'sequence' | 'time') {
  if (mode === 'sequence') return { start: 0, end: Math.max(1, records.length) };
  const timed = records.filter(
    (record): record is TraceRecord & { start: number; end: number } =>
      record.start !== undefined && record.end !== undefined,
  );
  if (!timed.length) return undefined;
  const start = Math.min(...timed.map((record) => record.start));
  return { start, end: Math.max(start + 1, ...timed.map((record) => record.end)) };
}
export function traceElapsed(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
/** Group only adjacent rows, so older/non-monotonic step metadata cannot reorder events. */
export function groupTrace(records: readonly TraceRecord[]) {
  return records.reduce<{ step: number; records: TraceRecord[] }[]>((groups, record) => {
    const previous = groups.at(-1);
    if (previous?.step === record.step) previous.records.push(record);
    else groups.push({ step: record.step, records: [record] });
    return groups;
  }, []);
}
