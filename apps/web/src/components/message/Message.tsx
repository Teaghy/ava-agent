import { useState } from 'react';
import Markdown from 'react-markdown';
import { Check, Copy, BookOpen, Square, AlertCircle } from 'lucide-react';
import { Brand } from '../Brand';
import type { ChatMessage, Citation } from '../../lib/protocol';
import { safeSource } from '../../lib/protocol';
export function Message({
  message,
  onSources,
}: {
  message: ChatMessage;
  onSources: (citations: Citation[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (message.role === 'user')
    return (
      <article className="user-message" aria-label="你的消息">
        <div>{message.content}</div>
      </article>
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };
  return (
    <article className="assistant-message" aria-label="Ava 的回答">
      <div className="assistant-heading">
        <Brand small />
        <span>Ava</span>
        <span className="assistant-label">客服助手</span>
      </div>
      {message.content ? (
        <div className="markdown">
          <Markdown
            skipHtml
            components={{
              a: ({ href, children }) =>
                safeSource(href) ? (
                  <a href={safeSource(href)} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {message.content}
          </Markdown>
        </div>
      ) : message.state === 'streaming' ? (
        <div className="thinking" aria-label="正在处理">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {message.state === 'failed' && (
        <div className="message-error" role="alert">
          <AlertCircle size={16} />
          {message.error}
        </div>
      )}
      {message.state === 'stopped' && (
        <p className="stopped-label">
          <Square size={11} /> 已停止生成
        </p>
      )}
      {message.state !== 'streaming' && message.content && (
        <div className="message-actions">
          {!!message.citations?.length && (
            <button className="source-button" onClick={() => onSources(message.citations ?? [])}>
              <BookOpen size={14} />
              参考 {message.citations.length} 条知识来源
            </button>
          )}
          <button
            className="icon-button copy-button"
            onClick={() => void copy()}
            aria-label={copied ? '已复制' : '复制回答'}
            title={copied ? '已复制' : '复制回答'}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {copyError && (
            <span role="status" className="muted">
              复制失败，请手动选择文字复制。
            </span>
          )}
        </div>
      )}
    </article>
  );
}
