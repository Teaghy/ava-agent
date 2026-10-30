import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentClient, ApiError, type Identity, type Member, type MemberRole } from '@ava/sdk';
import { ArrowUpRight, LogOut, Plus, ShieldCheck, Users, KeyRound } from 'lucide-react';
import { ApplicationsPanel } from './ApplicationsPanel';

const roles: Record<MemberRole, string> = {
  'tenant-admin': '租户管理员',
  'knowledge-editor': '知识维护人员',
  agent: '客服人员',
};
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试。');

function MemberRow({
  member,
  self,
  busy,
  onSave,
}: {
  member: Member;
  self: boolean;
  busy: boolean;
  onSave: (member: Member, role: MemberRole, active: boolean, password: string) => Promise<boolean>;
}) {
  const [role, setRole] = useState(member.role);
  const [active, setActive] = useState(member.active);
  const [password, setPassword] = useState('');
  return (
    <article className="member-row">
      <div className="member-name">
        <span className="avatar">{member.displayName.slice(0, 1)}</span>
        <div>
          <strong>
            {member.displayName}
            {self && <small>你</small>}
          </strong>
          <p>{member.userId}</p>
        </div>
      </div>
      <label>
        <span className="field-caption">角色</span>
        <select
          aria-label={`${member.userId} 的角色`}
          value={role}
          disabled={busy || self}
          onChange={(e) => setRole(e.target.value as MemberRole)}
        >
          {Object.entries(roles).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="status-control">
        <input
          type="checkbox"
          checked={active}
          disabled={busy || self}
          onChange={(e) => setActive(e.target.checked)}
        />
        {active ? '已启用' : '已停用'}
      </label>
      <label>
        <span className="field-caption">重置密码</span>
        <input
          aria-label={`${member.userId} 的新密码`}
          type="password"
          autoComplete="new-password"
          placeholder="留空保留密码"
          minLength={12}
          maxLength={128}
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        className="secondary"
        disabled={
          busy ||
          (role === member.role && active === member.active && !password) ||
          (!!password && password.length < 12)
        }
        onClick={() => {
          if (window.confirm(`确认修改 ${member.displayName}？该账号已有登录会话将失效。`))
            void onSave(member, role, active, password).then((ok) => {
              if (ok) setPassword('');
            });
        }}
      >
        保存
      </button>
    </article>
  );
}

export function App() {
  const [token, setToken] = useState('');
  const client = useMemo(() => new AgentClient({ token }), [token]);
  const [identity, setIdentity] = useState<Identity>();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [next, setNext] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState<'members' | 'applications'>('members');
  const revision = useRef(0);
  const actionBusy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setIdentity(undefined);
    setMembers([]);
    setNext(undefined);
    setError('');
    let inFlight = false;
    const check = async () => {
      if (inFlight || actionBusy.current) return;
      inFlight = true;
      const version = revision.current;
      try {
        const result = await client.identity.me(controller.signal);
        if (!controller.signal.aborted && version === revision.current)
          setIdentity((previous) =>
            JSON.stringify(previous) === JSON.stringify(result) ? previous : result,
          );
      } catch (e) {
        if (!controller.signal.aborted && version === revision.current) {
          if (e instanceof ApiError && e.status === 401) {
            setIdentity(undefined);
            setMembers([]);
          } else setError(message(e));
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setChecking(false);
      }
    };
    void check();
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 30000);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
      window.clearInterval(timer);
    };
  }, [client]);
  useEffect(() => {
    setMembers([]);
    setNext(undefined);
    setAdding(false);
    if (!identity?.manageMembers) return;
    const controller = new AbortController();
    void client.identity
      .members(undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setMembers(result.members);
        setNext(result.next);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [client, identity]);
  async function perform(action: () => Promise<void>) {
    revision.current++;
    actionBusy.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(message(e));
      if (e instanceof ApiError && e.status === 401) {
        setIdentity(undefined);
        setMembers([]);
        setToken('');
      }
      return false;
    } finally {
      actionBusy.current = false;
      setBusy(false);
    }
  }
  async function save(member: Member, role: MemberRole, active: boolean, password: string) {
    return perform(async () => {
      const updated = await client.identity.updateMember({
        userId: member.userId,
        version: member.version,
        role,
        active,
        ...(password ? { password } : {}),
      });
      setMembers((current) => current.map((m) => (m.userId === updated.userId ? updated : m)));
      setNotice('成员已更新，该账号已有登录会话已撤销。');
      if (!token && member.userId === identity?.userId) {
        setIdentity(undefined);
        setMembers([]);
      }
    });
  }
  return (
    <div className="app-shell">
      <aside>
        <a className="brand" href="/admin/">
          <span>A</span>Ava <small>业务管理</small>
        </a>
        <div className="nav-label">工作空间</div>
        <nav className="workspace-nav" aria-label="工作空间导航">
          <button
            className={`nav-item ${page === 'members' ? 'selected' : ''}`}
            disabled={!identity?.manageMembers || busy}
            onClick={() => setPage('members')}
          >
            <Users size={18} />
            成员与权限
          </button>
          <button
            className={`nav-item ${page === 'applications' ? 'selected' : ''}`}
            disabled={!identity?.manageMembers || busy}
            onClick={() => setPage('applications')}
          >
            <KeyRound size={18} />
            应用与凭证
          </button>
        </nav>
        <p className="sidebar-note">管理本租户的业务成员。模型、插件和技术排障由维护端负责。</p>
        <a className="chat-link" href="/">
          打开客服端 <ArrowUpRight size={16} />
        </a>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">
              WORKSPACE / {page === 'members' ? 'MEMBERS' : 'APPLICATIONS'}
            </span>
            <h1>{page === 'members' ? '成员与权限' : '应用与凭证'}</h1>
          </div>
          {identity && (
            <div className="account">
              <span>
                {identity.displayName}
                <small>{identity.tenantId}</small>
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (token) setToken('');
                    else await client.identity.logout();
                    setIdentity(undefined);
                    setMembers([]);
                    setNext(undefined);
                    setAdding(false);
                  })
                }
              >
                <LogOut size={15} />
                退出
              </button>
            </div>
          )}
        </header>
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
        {checking ? (
          <p role="status">正在检查登录状态…</p>
        ) : !identity ? (
          <section className="login-card">
            <ShieldCheck size={30} />
            <h2>登录工作空间</h2>
            <p>使用管理员为你创建的账号。登录状态由服务端安全保存。</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void perform(async () => {
                  const result = await client.identity.login({
                    tenantId: String(data.get('tenantId')),
                    userId: String(data.get('userId')),
                    password: String(data.get('password')),
                  });
                  setToken('');
                  setIdentity(result.identity);
                });
              }}
            >
              <label>
                租户 ID
                <input
                  name="tenantId"
                  autoComplete="organization"
                  required
                  maxLength={200}
                  disabled={busy}
                />
              </label>
              <label>
                账号
                <input
                  name="userId"
                  autoComplete="username"
                  required
                  maxLength={200}
                  disabled={busy}
                />
              </label>
              <label>
                密码
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  disabled={busy}
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? '正在登录…' : '登录'}
              </button>
            </form>
            <details>
              <summary>使用现有管理员 Token 迁移</summary>
              <p>仅用于初始化账号。凭证只在当前页面内存中使用，不会保存。</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setToken(String(new FormData(e.currentTarget).get('token')).trim());
                  e.currentTarget.reset();
                }}
              >
                <label>
                  业务管理员 Token
                  <input name="token" type="password" autoComplete="off" required disabled={busy} />
                </label>
                <button className="secondary" disabled={busy}>
                  连接并创建本地账号
                </button>
              </form>
            </details>
          </section>
        ) : !identity.manageMembers ? (
          <section className="empty">
            <ShieldCheck size={30} />
            <h2>你已登录</h2>
            <p>
              当前角色：{identity.role ? roles[identity.role] : 'API 身份'}
              。成员管理需要租户管理员权限。
            </p>
            <a href="/">前往客服端 →</a>
          </section>
        ) : page === 'applications' ? (
          <ApplicationsPanel
            key={`${identity.tenantId}:${identity.userId}`}
            client={client}
            onUnauthorized={() => {
              setIdentity(undefined);
              setMembers([]);
              setToken('');
            }}
          />
        ) : (
          <>
            <section className="section-heading">
              <div>
                <h2>工作空间成员</h2>
                <p>
                  当前租户：{identity.tenantId}。角色变更、停用与密码重置会撤销该成员已有登录会话。
                </p>
              </div>
              <button className="primary" disabled={busy} onClick={() => setAdding(!adding)}>
                <Plus size={16} />
                {adding ? '收起' : '添加成员'}
              </button>
            </section>
            {adding && (
              <form
                className="create-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const data = new FormData(form);
                  void perform(async () => {
                    await client.identity.createMember({
                      userId: String(data.get('userId')),
                      displayName: String(data.get('displayName')),
                      password: String(data.get('password')),
                      role: String(data.get('role')) as MemberRole,
                    });
                    const result = await client.identity.members();
                    setMembers(result.members);
                    setNext(result.next);
                    form.reset();
                    setAdding(false);
                    setNotice('成员已创建，请通过私密渠道交付初始密码。');
                  });
                }}
              >
                <h3>添加成员</h3>
                <div className="create-fields">
                  <label>
                    账号 ID
                    <input
                      name="userId"
                      required
                      maxLength={200}
                      autoComplete="off"
                      disabled={busy}
                      placeholder="迁移时使用原 userId"
                    />
                  </label>
                  <label>
                    显示名称
                    <input name="displayName" required maxLength={100} disabled={busy} />
                  </label>
                  <label>
                    角色
                    <select name="role" defaultValue="agent" disabled={busy}>
                      {Object.entries(roles).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    初始密码
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      disabled={busy}
                      placeholder="至少 12 个字符"
                    />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  {busy ? '正在保存…' : '创建成员'}
                </button>
              </form>
            )}
            <div className="member-list">
              {members.length ? (
                members.map((member) => (
                  <MemberRow
                    key={`${member.userId}:${member.version}`}
                    member={member}
                    self={member.userId === identity.userId}
                    busy={busy}
                    onSave={save}
                  />
                ))
              ) : (
                <div className="empty">
                  暂无本地账号。可以先为现有用户创建同名账号，保留原有数据归属。
                </div>
              )}
            </div>
            {next && (
              <button
                className="secondary load-more"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await client.identity.members(next);
                    setMembers((current) => [...current, ...result.members]);
                    setNext(result.next);
                  })
                }
              >
                加载更多成员
              </button>
            )}
            <section className="role-guide">
              <h3>角色说明</h3>
              <p>
                <strong>租户管理员</strong>：管理本租户成员和知识。<strong>知识维护人员</strong>
                ：维护知识并使用客服。<strong>客服人员</strong>：使用客服。
              </p>
              <p>业务角色均不授予 Ops 维护权限。知识管理页面将在后续加入。</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
