import { useEffect, useRef, useState } from 'react';
import { AgentClient, ApiError, type Application, type ApplicationKeyView } from '@ava/sdk';
import { Copy, Eye, EyeOff, KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { Select, Checkbox, DateTimePicker, useConfirm } from '@ava/ui';

const dateText = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';

export function ApplicationsPanel({
  client,
  onUnauthorized,
}: {
  client: AgentClient;
  onUnauthorized: () => void;
}) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [next, setNext] = useState<string>();
  const [selected, setSelected] = useState('');
  const [keys, setKeys] = useState<ApplicationKeyView[]>([]);
  const [keyNext, setKeyNext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [keysLoading, setKeysLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [secret, setSecret] = useState('');
  const [revealed, setRevealed] = useState(false);
  const keyRequestVersion = useRef(0);
  const confirm = useConfirm();
  const application = applications.find((a) => a.applicationId === selected);

  useEffect(() => {
    const controller = new AbortController();
    void client.applications
      .list(undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setApplications(result.applications);
        setNext(result.next);
        setSelected(result.applications[0]?.applicationId ?? '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(errorText(e));
          if (e instanceof ApiError && e.status === 401) onUnauthorized();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client]);
  useEffect(() => {
    const version = ++keyRequestVersion.current;
    setKeys([]);
    setKeyNext(undefined);
    setSecret('');
    setRevealed(false);
    setIssuing(false);
    if (!selected) return;
    setKeysLoading(true);
    const controller = new AbortController();
    void client.applications
      .keys(selected, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted && version === keyRequestVersion.current) {
          setKeys(result.keys);
          setKeyNext(result.next);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && version === keyRequestVersion.current) {
          setError(errorText(e));
          if (e instanceof ApiError && e.status === 401) onUnauthorized();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && version === keyRequestVersion.current)
          setKeysLoading(false);
      });
    return () => controller.abort();
  }, [client, selected]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
    } finally {
      setBusy(false);
    }
  }
  function select(id: string) {
    if (id === selected) return;
    keyRequestVersion.current++;
    setKeys([]);
    setKeyNext(undefined);
    setSecret('');
    setRevealed(false);
    setIssuing(false);
    setKeysLoading(true);
    setSelected(id);
    setError('');
    setNotice('');
  }
  return (
    <section className="applications-panel">
      <div className="section-heading">
        <div>
          <h2>应用接入</h2>
          <p>为设备和后台分配独立凭证。接入方管理自己的用户，会话按应用隔离。</p>
        </div>
        <button
          className="primary"
          disabled={busy || loading}
          onClick={() => setCreating(!creating)}
        >
          <Plus size={16} />
          {creating ? '收起' : '创建应用'}
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}
      {creating && (
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            void perform(async () => {
              const created = await client.applications.create({
                applicationId: String(data.get('applicationId')),
                knowledgeSpaceId: String(data.get('knowledgeSpaceId')),
                name: String(data.get('name')),
              });
              setApplications((current) => [created, ...current]);
              select(created.applicationId);
              setCreating(false);
              form.reset();
              setNotice('应用已创建，可以签发接入 Key。');
            });
          }}
        >
          <h3>创建应用</h3>
          <div className="create-fields">
            <label>
              应用名称
              <input
                name="name"
                required
                maxLength={100}
                disabled={busy}
                placeholder="例如 VCD 8.6 设备 A"
              />
            </label>
            <label>
              应用 ID
              <input
                name="applicationId"
                required
                maxLength={100}
                disabled={busy}
                placeholder="例如 vcd86-device-a"
              />
            </label>
            <label>
              知识空间 ID
              <input
                name="knowledgeSpaceId"
                required
                maxLength={100}
                disabled={busy}
                placeholder="例如 vcd86"
              />
            </label>
          </div>
          <p>
            ID 仅使用字母、数字、点、下划线和连字符，创建后不可更改。多个应用填写相同知识空间 ID
            即可共享资料。
          </p>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '创建应用'}
          </button>
        </form>
      )}
      {loading ? (
        <p role="status">正在加载应用…</p>
      ) : !applications.length ? (
        <div className="empty">
          <KeyRound size={30} />
          <h2>还没有应用</h2>
          <p>创建第一个设备或后台应用，绑定知识空间后签发接入凭证。</p>
        </div>
      ) : (
        <div className="application-layout">
          <nav className="application-list" aria-label="应用列表">
            {applications.map((app) => (
              <button
                className={`application-item ${selected === app.applicationId ? 'selected' : ''}`}
                key={app.applicationId}
                aria-current={selected === app.applicationId ? 'true' : undefined}
                disabled={busy}
                onClick={() => select(app.applicationId)}
              >
                <strong>{app.name}</strong>
                <span>{app.applicationId}</span>
                <small>
                  {app.active ? '已启用' : '已停用'} · {app.knowledgeSpaceId}
                </small>
              </button>
            ))}
            {next && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await client.applications.list(next);
                    setApplications((current) => [
                      ...new Map(
                        [...current, ...result.applications].map((app) => [app.applicationId, app]),
                      ).values(),
                    ]);
                    setNext(result.next);
                  })
                }
              >
                加载更多应用
              </button>
            )}
          </nav>
          {application && (
            <div className="application-detail">
              <section className="application-summary">
                <div>
                  <h2>{application.name}</h2>
                  <p>应用 ID：{application.applicationId}</p>
                  <p>
                    知识空间：<strong>{application.knowledgeSpaceId}</strong>
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: application.active ? '停用此应用？' : '启用此应用？',
                        description: application.active
                          ? '停用后，此应用的全部 Key 将立即失效。'
                          : '已撤销的 Key 不会恢复。',
                        confirmLabel: application.active ? '停用应用' : '启用应用',
                        danger: application.active,
                      }))
                    )
                      return;
                    void perform(async () => {
                      const updated = await client.applications.update({
                        applicationId: application.applicationId,
                        version: application.version,
                        active: !application.active,
                      });
                      setApplications((current) =>
                        current.map((app) =>
                          app.applicationId === updated.applicationId ? updated : app,
                        ),
                      );
                      setNotice(
                        updated.active
                          ? '应用已启用，已撤销凭证保持失效。'
                          : '应用已停用，全部凭证已停止接受新请求。',
                      );
                    });
                  }}
                >
                  {application.active ? '停用应用' : '启用应用'}
                </button>
              </section>
              <div className="section-heading key-heading">
                <div>
                  <h3>接入凭证</h3>
                  <p>轮换时先签发新 Key，更新调用方，再撤销旧 Key。</p>
                </div>
                <button
                  className="primary"
                  disabled={busy || keysLoading || !application.active || !!secret}
                  onClick={() => setIssuing(!issuing)}
                >
                  <Plus size={15} />
                  {issuing ? '收起' : '签发 Key'}
                </button>
              </div>
              {issuing && (
                <form
                  className="create-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const data = new FormData(form);
                    void perform(async () => {
                      const permissions: ApplicationKeyView['permissions'] = ['READ'];
                      if (data.has('write')) permissions.push('WRITE');
                      if (data.has('critical')) permissions.push('CRITICAL');
                      const expiry = String(data.get('expiresAt'));
                      const capability = String(data.get('capability'));
                      const issued = await client.applications.issueKey({
                        applicationId: application.applicationId,
                        label: String(data.get('label')),
                        permissions,
                        allowChat: capability !== 'knowledge',
                        manageKnowledge: capability !== 'chat',
                        ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
                      });
                      setSecret(issued.secret);
                      setRevealed(false);
                      setKeys((current) => [issued.key, ...current]);
                      setIssuing(false);
                      form.reset();
                    });
                  }}
                >
                  <div className="create-fields">
                    <label>
                      凭证名称
                      <input
                        name="label"
                        required
                        maxLength={100}
                        disabled={busy}
                        placeholder="例如设备生产凭证"
                      />
                    </label>
                    <label>
                      允许的用途
                      <Select
                        name="capability"
                        aria-label="凭证用途"
                        defaultValue="chat"
                        disabled={busy}
                        options={[
                          { value: 'chat', label: '对话与检索' },
                          { value: 'knowledge', label: '仅导入知识' },
                          { value: 'both', label: '对话与知识导入' },
                        ]}
                      />
                    </label>
                    <label>
                      到期时间（可选）
                      <DateTimePicker name="expiresAt" aria-label="凭证到期时间" disabled={busy} />
                      <span>留空则长期有效，按当前设备时区设置。</span>
                    </label>
                  </div>
                  <details>
                    <summary className="ui-disclosure">高级工具权限</summary>
                    <p>默认仅 READ。只在需要执行对应业务工具时额外授权。</p>
                    <label className="status-control">
                      <Checkbox name="write" disabled={busy} />
                      允许 WRITE 工具
                    </label>
                    <label className="status-control">
                      <Checkbox name="critical" disabled={busy} />
                      允许 CRITICAL 工具
                    </label>
                  </details>
                  <button className="primary" disabled={busy}>
                    {busy ? '正在签发…' : '签发 Key'}
                  </button>
                </form>
              )}
              {secret && (
                <section className="issued-secret" aria-labelledby="issued-key-title">
                  <ShieldCheck size={22} />
                  <h3 id="issued-key-title">Key 已签发，仅展示这一次</h3>
                  <p>
                    请保存到接入方的安全配置中。关闭或离开本页后无法再次查看，可撤销后重新签发。
                  </p>
                  <div className="secret-controls">
                    <input
                      aria-label="新签发的应用 Key"
                      type={revealed ? 'text' : 'password'}
                      readOnly
                      value={secret}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      className="secondary"
                      onClick={() => setRevealed(!revealed)}
                      aria-label={revealed ? '隐藏 Key' : '显示 Key'}
                    >
                      {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(secret)
                          .then(() => setNotice('Key 已复制，请妥善保存。'))
                          .catch(() => setError('复制失败，请显示 Key 后手动复制。'))
                      }
                    >
                      <Copy size={15} />
                      复制
                    </button>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSecret('');
                      setRevealed(false);
                    }}
                  >
                    已保存，关闭
                  </button>
                </section>
              )}
              <div className="credential-list">
                {keysLoading ? (
                  <p role="status">正在读取凭证…</p>
                ) : keys.length ? (
                  keys.map((key) => {
                    const status = key.revokedAt
                      ? '已撤销'
                      : key.expiresAt && Date.parse(key.expiresAt) <= Date.now()
                        ? '已到期'
                        : !application.active
                          ? '应用停用'
                          : '有效';
                    return (
                      <article className="credential-card" key={key.id}>
                        <div className="credential-header">
                          <div>
                            <strong>{key.label}</strong>
                            <code>{key.hint}</code>
                          </div>
                          <span
                            className={`credential-status ${status === '有效' ? 'active' : ''}`}
                          >
                            {status}
                          </span>
                        </div>
                        <div className="credential-tags">
                          {key.allowChat && <span>对话与检索</span>}
                          {key.manageKnowledge && <span>知识导入</span>}
                          <span>{key.permissions.join(' / ')}</span>
                          <span>{key.source === 'environment' ? '环境导入' : '在线签发'}</span>
                        </div>
                        <p>
                          创建：{dateText(key.createdAt)}
                          <br />
                          到期：{key.expiresAt ? dateText(key.expiresAt) : '未设置'}
                        </p>
                        <button
                          className="secondary"
                          disabled={busy || !!key.revokedAt}
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: '撤销此 Key？',
                                description: `确认撤销“${key.label}”？该 Key 将立即停止接受新请求，无法恢复。`,
                                confirmLabel: '撤销 Key',
                                danger: true,
                              }))
                            )
                              return;
                            void perform(async () => {
                              await client.applications.revokeKey(
                                application.applicationId,
                                key.id,
                              );
                              setKeys((current) =>
                                current.map((item) =>
                                  item.id === key.id
                                    ? { ...item, revokedAt: new Date().toISOString() }
                                    : item,
                                ),
                              );
                              setSecret('');
                              setNotice('凭证已撤销，无需重启服务。');
                            });
                          }}
                        >
                          {key.revokedAt ? '已撤销' : '撤销 Key'}
                        </button>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty">此应用还没有凭证，签发后即可接入。</div>
                )}
              </div>
              {keyNext && (
                <button
                  className="secondary load-more"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = await client.applications.keys(
                        application.applicationId,
                        keyNext,
                      );
                      setKeys((current) => [
                        ...new Map(
                          [...current, ...result.keys].map((key) => [key.id, key]),
                        ).values(),
                      ]);
                      setKeyNext(result.next);
                    })
                  }
                >
                  加载更多凭证
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
