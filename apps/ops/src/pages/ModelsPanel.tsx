import { useEffect, useState, type FormEvent } from 'react';
import { AgentClient } from '@ava/sdk';
import type { ModelSettingsView } from '@ava/protocol';
import {
  defaultModelCompatibility,
  modelCompatibilitySchema,
  type ModelCompatibilityOptions,
} from '@ava/protocol';
import { Cpu, Database, LoaderCircle, RefreshCw, Check, CircleAlert } from 'lucide-react';
import './models.css';

const phases = {
  queued: '等待切换',
  validating: '正在验证模型连接',
  reindexing: '正在重建知识库向量',
  applying: '正在应用配置',
  completed: '配置已生效',
  failed: '配置未能生效',
};
type Connection = { baseURL: string; model: string };
type Llm = Connection & { compatibility: ModelCompatibilityOptions };
type Embedding = Connection & { dimensions: number; batchSize: number };
const formatLabels = { preserve: '保留消息结构', 'single-system-first': '单条 system 置顶' };
const message = (error: unknown) => (error instanceof Error ? error.message : '读取模型配置失败。');
export function ModelsPanel({ token }: { token: string }) {
  const [view, setView] = useState<ModelSettingsView>();
  const [llm, setLlm] = useState<Llm>({
    baseURL: '',
    model: '',
    compatibility: defaultModelCompatibility,
  });
  const [embedding, setEmbedding] = useState<Embedding>({
    baseURL: '',
    model: '',
    dimensions: 1024,
    batchSize: 10,
  });
  const [llmKey, setLlmKey] = useState(''),
    [embeddingKey, setEmbeddingKey] = useState('');
  const [clearLlm, setClearLlm] = useState(false),
    [clearEmbedding, setClearEmbedding] = useState(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const running = !!view?.job && !['completed', 'failed'].includes(view.job.status);
  const disabled = !token || !view?.enabled || running || saving;
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void new AgentClient({ token }).models
      .get(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setView(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [token]);
  const resetDraft = (next: ModelSettingsView) => {
    setLlm({
      baseURL: next.llm.baseURL,
      model: next.llm.model,
      compatibility: next.llm.compatibility,
    });
    setEmbedding({
      baseURL: next.embedding.baseURL,
      model: next.embedding.model,
      dimensions: next.embedding.dimensions,
      batchSize: next.embedding.batchSize,
    });
    setLlmKey('');
    setEmbeddingKey('');
    setClearLlm(false);
    setClearEmbedding(false);
  };
  useEffect(() => {
    if (view) resetDraft(view);
  }, [view?.revision]);
  useEffect(() => {
    if (!running || !token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await new AgentClient({ token }).models.get(controller.signal);
        if (!controller.signal.aborted) {
          setView(next);
          setError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [running, token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !view) return;
    setSaving(true);
    setError('');
    try {
      const next = await new AgentClient({ token }).models.apply({
        revision: view.revision,
        llm: {
          ...llm,
          ...(clearLlm ? { apiKey: null } : llmKey.trim() ? { apiKey: llmKey.trim() } : {}),
        },
        embedding: {
          ...embedding,
          ...(clearEmbedding
            ? { apiKey: null }
            : embeddingKey.trim()
              ? { apiKey: embeddingKey.trim() }
              : {}),
        },
      });
      setView(next);
      setLlmKey('');
      setEmbeddingKey('');
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  };
  const refresh = async () => {
    try {
      const next = await new AgentClient({ token }).models.get();
      setView(next);
      resetDraft(next);
      setError('');
    } catch (error) {
      setError(message(error));
    }
  };
  const setCompatibility = (key: keyof ModelCompatibilityOptions, value: string) =>
    setLlm({
      ...llm,
      compatibility: modelCompatibilitySchema.parse({ ...llm.compatibility, [key]: value }),
    });
  if (!token)
    return (
      <section className="plugins-panel runs-empty">
        <Cpu size={28} />
        <h2>连接后配置模型</h2>
        <p>使用具备插件管理权限的维护 Token 连接。</p>
      </section>
    );
  return (
    <section className="models-panel" aria-label="模型配置">
      <div className="models-intro">
        <div>
          <h2>模型与访问凭证</h2>
          <p>首次读取 .env；页面应用成功后优先使用已保存配置，无需重启进程。</p>
        </div>
        <button
          type="button"
          className="plugins-button"
          disabled={running || saving}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          刷新配置
        </button>
      </div>
      {!view && !error && (
        <p role="status">
          <LoaderCircle className="spinner" size={16} /> 正在读取配置…
        </p>
      )}
      {view?.reason && (
        <p className="plugins-feedback" role="status">
          {view.reason}
        </p>
      )}
      {error && (
        <p className="plugins-feedback plugins-feedback-error" role="alert">
          <CircleAlert size={16} />
          {error}
        </p>
      )}
      {view && (
        <form onSubmit={(event) => void submit(event)}>
          <div className="models-grid">
            <fieldset className="plugins-panel models-card" disabled={disabled}>
              <legend>
                <Cpu size={18} />
                语言模型 · LLM
              </legend>
              <p>用于执行决策和最终回答生成。</p>
              <label>
                LLM Base URL
                <input
                  type="url"
                  required
                  value={llm.baseURL}
                  onChange={(e) =>
                    setLlm({
                      ...llm,
                      baseURL: e.target.value,
                      compatibility: defaultModelCompatibility,
                    })
                  }
                />
              </label>
              <label>
                LLM 模型名称
                <input
                  required
                  value={llm.model}
                  onChange={(e) =>
                    setLlm({
                      ...llm,
                      model: e.target.value,
                      compatibility: defaultModelCompatibility,
                    })
                  }
                  placeholder="例如 deepseek-flash"
                />
              </label>
              <label>
                LLM API Key <span>{view.llm.keyConfigured ? '已配置' : '未配置'}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={llmKey}
                  disabled={clearLlm}
                  onChange={(e) => setLlmKey(e.target.value)}
                  placeholder={
                    view.llm.keyConfigured
                      ? '留空保留现有 Key；填写以替换'
                      : '填写模型供应商的 API Key'
                  }
                />
              </label>
              {view.llm.keyConfigured && (
                <label className="models-checkbox">
                  <input
                    type="checkbox"
                    checked={clearLlm}
                    onChange={(e) => {
                      setClearLlm(e.target.checked);
                      setLlmKey('');
                    }}
                  />
                  清除已保存的 LLM Key
                </label>
              )}
              <details className="models-compatibility">
                <summary>高级兼容设置</summary>
                <p>
                  自动按服务地址和模型匹配已知规则；更换地址或模型会恢复为自动。保存前验证多轮决策和流式正文。
                </p>
                <label>
                  消息格式
                  <select
                    value={llm.compatibility.messageFormat}
                    onChange={(e) => setCompatibility('messageFormat', e.target.value)}
                  >
                    <option value="auto">自动（匹配已知规则）</option>
                    <option value="preserve">保留消息结构</option>
                    <option value="single-system-first">单条 system 置顶</option>
                  </select>
                </label>
                <label>
                  JSON 输出方式
                  <select
                    value={llm.compatibility.jsonOutput}
                    onChange={(e) => setCompatibility('jsonOutput', e.target.value)}
                  >
                    <option value="auto">自动（匹配已知规则）</option>
                    <option value="json-object">JSON 对象参数</option>
                    <option value="prompt">仅提示词约束（仍严格校验结果）</option>
                  </select>
                </label>
                <label>
                  流式用量参数
                  <select
                    value={llm.compatibility.streamUsage}
                    onChange={(e) => setCompatibility('streamUsage', e.target.value)}
                  >
                    <option value="auto">自动（匹配已知规则）</option>
                    <option value="enabled">发送 include_usage</option>
                    <option value="disabled">不发送流式用量参数</option>
                  </select>
                </label>
                {view.llm.effectiveCompatibility && (
                  <p className="models-effective">
                    当前运行配置：
                    {view.llm.effectiveCompatibility.source === 'known-model'
                      ? '已知模型规则'
                      : view.llm.effectiveCompatibility.source === 'override'
                        ? '人工覆盖'
                        : '默认规则'}{' '}
                    · {formatLabels[view.llm.effectiveCompatibility.messageFormat]} ·{' '}
                    {view.llm.effectiveCompatibility.jsonOutput === 'json-object'
                      ? 'JSON 对象参数'
                      : '提示词 JSON'}{' '}
                    · {view.llm.effectiveCompatibility.streamUsage ? '发送' : '不发送'}流式用量参数
                    {view.llm.effectiveCompatibility.rule && (
                      <>
                        <br />
                        匹配规则：{view.llm.effectiveCompatibility.rule.label}
                      </>
                    )}
                  </p>
                )}
              </details>
            </fieldset>
            <fieldset className="plugins-panel models-card" disabled={disabled}>
              <legend>
                <Database size={18} />
                向量模型 · Embedding
              </legend>
              <p>更换地址、模型或维度后自动重建所有租户的已发布知识。</p>
              <label>
                Embedding Base URL
                <input
                  type="url"
                  required
                  value={embedding.baseURL}
                  onChange={(e) => setEmbedding({ ...embedding, baseURL: e.target.value })}
                />
              </label>
              <label>
                Embedding 模型名称
                <input
                  required
                  value={embedding.model}
                  onChange={(e) => setEmbedding({ ...embedding, model: e.target.value })}
                />
              </label>
              <div className="models-numbers">
                <label>
                  向量维度
                  <input
                    type="number"
                    required
                    min={1}
                    max={65536}
                    value={embedding.dimensions}
                    onChange={(e) =>
                      setEmbedding({ ...embedding, dimensions: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  每批文本数
                  <input
                    type="number"
                    required
                    min={1}
                    max={2048}
                    value={embedding.batchSize}
                    onChange={(e) =>
                      setEmbedding({ ...embedding, batchSize: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                Embedding API Key <span>{view.embedding.keyConfigured ? '已配置' : '未配置'}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={embeddingKey}
                  disabled={clearEmbedding}
                  onChange={(e) => setEmbeddingKey(e.target.value)}
                  placeholder={
                    view.embedding.keyConfigured
                      ? '留空保留现有 Key；填写以替换'
                      : '填写向量模型供应商的 API Key'
                  }
                />
              </label>
              {view.embedding.keyConfigured && (
                <label className="models-checkbox">
                  <input
                    type="checkbox"
                    checked={clearEmbedding}
                    onChange={(e) => {
                      setClearEmbedding(e.target.checked);
                      setEmbeddingKey('');
                    }}
                  />
                  清除已保存的 Embedding Key
                </label>
              )}
              <p className="models-collection">
                当前索引：<code>{view.embedding.collection}</code>
              </p>
            </fieldset>
          </div>
          {(clearLlm || clearEmbedding) && (
            <p className="plugins-feedback" role="status">
              清除 Key 后对应模型将暂停调用，直到重新配置。
            </p>
          )}
          <div className="models-apply">
            <p>
              应用会取消正在生成的回答，期间暂停新请求与知识导入；验证或重建失败会保留原配置。Key
              仅保存于服务端，不会回显。
            </p>
            <button
              type="submit"
              className="plugins-button plugins-button-primary"
              disabled={disabled}
            >
              {saving || running ? (
                <LoaderCircle size={15} className="spinner" />
              ) : (
                <Check size={15} />
              )}
              {saving || running ? '正在应用…' : '验证并应用'}
            </button>
          </div>
          <p className="models-source">
            配置来源：{view.source === 'env' ? '.env 默认值' : 'Ops 已保存配置'} ·{' '}
            {view.persistent ? '重启后恢复' : '仅当前进程'} · 版本 {view.revision}
          </p>
        </form>
      )}
      {view?.job && (
        <div
          className={`plugins-panel models-job ${view.job.status === 'failed' ? 'models-job-failed' : ''}`}
          role="status"
        >
          <strong>
            {running ? (
              <LoaderCircle size={16} className="spinner" />
            ) : view.job.status === 'completed' ? (
              <Check size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            {phases[view.job.status]}
          </strong>
          {view.job.status === 'reindexing' && (
            <p>
              已重建 {view.job.processed} 个分片，已扫描 {view.job.total} 个。
            </p>
          )}
          {view.job.error && <p>{view.job.error}</p>}
          {view.job.checks && (
            <p>
              多轮决策：{view.job.checks.structuredOutput ? '已通过' : '尚未通过'} · 流式正文：
              {view.job.checks.streaming ? '已通过' : '未验证或未通过'}
            </p>
          )}
          {view.job.status === 'completed' && (
            <p>
              配置已在当前服务生效
              {view.job.processed ? `，重建了 ${view.job.processed} 个知识分片` : ''}。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
