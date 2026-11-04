import { useState } from 'react';
import { AgentClient, type Identity } from '@ava/sdk';

export function AccountSettings({
  identity,
  onChange,
}: {
  identity?: Identity;
  onChange: (identity?: Identity) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-settings">
      <h3>工作空间账号</h3>
      {identity ? (
        <>
          <p className="settings-note">
            {identity.displayName} · {identity.tenantId} / {identity.userId}
          </p>
          <div className="dialog-footer">
            {identity.manageMembers && (
              <a href="/admin/" className="secondary-button">
                成员管理
              </a>
            )}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await new AgentClient().identity.logout();
                  onChange();
                })
              }
            >
              退出账号
            </button>
          </div>
          <details>
            <summary className="ui-disclosure">修改密码</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                void perform(async () => {
                  await new AgentClient().identity.changePassword({
                    currentPassword: String(data.get('currentPassword')),
                    newPassword: String(data.get('newPassword')),
                  });
                  form.reset();
                  onChange();
                });
              }}
            >
              <label htmlFor="current-password">当前密码</label>
              <input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
              />
              <label htmlFor="new-password">新密码</label>
              <input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
              <p className="settings-note">修改后需要重新登录，其他设备的登录也会失效。</p>
              <div className="dialog-footer">
                <button className="primary-button" disabled={busy}>
                  修改并退出
                </button>
              </div>
            </form>
          </details>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            void perform(async () => {
              const result = await new AgentClient().identity.login({
                tenantId: String(data.get('tenantId')),
                userId: String(data.get('userId')),
                password: String(data.get('password')),
              });
              form.reset();
              onChange(result.identity);
            });
          }}
        >
          <label htmlFor="account-tenant">租户 ID</label>
          <input
            id="account-tenant"
            name="tenantId"
            autoComplete="organization"
            required
            maxLength={200}
            disabled={busy}
          />
          <label htmlFor="account-user">账号</label>
          <input
            id="account-user"
            name="userId"
            autoComplete="username"
            required
            maxLength={200}
            disabled={busy}
          />
          <label htmlFor="account-password">密码</label>
          <input
            id="account-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={busy}
          />
          <div className="dialog-footer">
            <button className="primary-button" disabled={busy}>
              {busy ? '正在登录…' : '登录'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="settings-note">
          {error}
        </p>
      )}
    </section>
  );
}
