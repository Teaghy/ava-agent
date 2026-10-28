import { useEffect, useRef, useState } from 'react';
import { X, KeyRound, Database, ShieldCheck } from 'lucide-react';
import type { ClientConfig } from '../../lib/protocol';
export function Settings({
  open,
  config,
  token,
  onClose,
  onApply,
}: {
  open: boolean;
  config?: ClientConfig;
  token: string;
  onClose: () => void;
  onApply: (token: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(token);
  useEffect(() => {
    if (open) {
      setDraft(token);
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open, token]);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="settings-title"
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
              ? '已配置 Mem0 OSS 服务；运行时按需召回。'
              : '当前使用内置存储，尚未启用 Mem0 OSS。'}
          </p>
        </div>
        <span className="small-tag">
          {config?.memoryProvider === 'mem0-oss-rest' ? 'Mem0 OSS' : '内置存储'}
        </span>
      </div>
      <p className="settings-note">
        长期记忆与聊天记录分开管理。当前不会自动把对话内容写入长期记忆。
      </p>
      <div className="service-row">
        <ShieldCheck size={18} />
        <div>
          <strong>会话保存</strong>
          <p>
            {config?.persistence === 'postgres'
              ? '对话记录保存在服务端数据库。'
              : '当前为内存模式，服务重启后记录将清空。'}
          </p>
        </div>
      </div>
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
          Token 只保留在当前页面内存中。更换身份会清空当前页面的对话视图。
        </p>
        <div className="dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit">
            应用连接
          </button>
        </div>
      </form>
    </dialog>
  );
}
