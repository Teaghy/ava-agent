import { Modal } from '@ava/ui';
import { useEffect, useState } from 'react';
import { X, KeyRound, Database, ShieldCheck } from 'lucide-react';
import type { ClientConfig } from '../../lib/protocol';
import type { Identity } from '@ava/sdk';
import { AccountSettings } from './AccountSettings';
export function Settings({
  open,
  config,
  token,
  onClose,
  onApply,
  identity,
  onIdentityChange,
}: {
  open: boolean;
  config?: ClientConfig;
  token: string;
  onClose: () => void;
  onApply: (token: string) => void;
  identity?: Identity;
  onIdentityChange: (identity?: Identity) => void;
}) {
  const [draft, setDraft] = useState(token);
  useEffect(() => {
    if (open) {
      setDraft(token);
    }
  }, [open, token]);
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="settings-dialog"
      title="连接与服务"
      description="管理工作空间登录与服务连接。"
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h2 id="settings-title">连接与服务</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭设置">
          <X size={20} />
        </button>
      </div>
      <div className="service-row">
        <Database size={18} />
        <div>
          <strong>长期记忆</strong>
          <p>
            {config?.memoryProvider === 'mem0-oss-rest'
              ? '已配置 Mem0 OSS 服务。'
              : config?.memoryProvider === 'custom'
                ? '当前使用自定义长期记忆插件。'
                : '当前使用内置存储，尚未启用 Mem0 OSS。'}
          </p>
        </div>
        <span className="small-tag">
          {config?.memoryProvider === 'custom'
            ? '自定义插件'
            : config?.memoryProvider === 'mem0-oss-rest'
              ? 'Mem0 OSS'
              : '内置存储'}
        </span>
      </div>
      <p className="settings-note">
        {config?.memoryToolsEnabled
          ? '个人记忆支持按需检索。发送「请记住：内容」保存，发送「请忘记：记忆 ID」遗忘。'
          : '长期记忆与聊天记录分开管理。当前服务未启用个人记忆工具。'}
      </p>
      <div className="service-row">
        <ShieldCheck size={18} />
        <div>
          <strong>会话保存</strong>
          <p>
            {config?.persistence === 'postgres'
              ? '对话记录保存在服务端数据库。'
              : config?.persistence === 'custom'
                ? '会话由自定义存储插件管理，保存方式由服务端配置。'
                : '当前为内存模式，服务重启后记录将清空。'}
          </p>
        </div>
      </div>
      {config?.localAuthEnabled && (
        <AccountSettings identity={identity} onChange={onIdentityChange} />
      )}
      <details open={!config?.localAuthEnabled || !!token}>
        <summary className="ui-disclosure">使用 API Token 连接</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onApply(draft.trim());
            onClose();
          }}
        >
          <label htmlFor="api-token">
            <KeyRound size={15} />
            服务访问 Token{!config?.authRequired && <span>（当前可留空）</span>}
          </label>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              config?.authRequired ? '输入管理员提供的访问 Token' : '本地演示模式无需 Token'
            }
          />
          <p className="settings-note">
            Token 保存在当前标签页会话中，刷新后自动恢复。更换身份会清空当前对话视图。
          </p>
          <div className="dialog-footer">
            {token && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setDraft('');
                  onApply('');
                  onClose();
                }}
              >
                清除 Token
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" type="submit">
              应用连接
            </button>
          </div>
        </form>
      </details>
    </Modal>
  );
}
