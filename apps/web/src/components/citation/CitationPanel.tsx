import { BookOpen, Check, X, ExternalLink, ShieldCheck } from 'lucide-react';
import { safeSource } from '@ava/shared';
import type { Citation } from '@ava/protocol';
export function CitationPanel({ sources, onClose }: { sources: Citation[]; onClose: () => void }) {
  return (
    <aside className="sources-panel" aria-label="知识来源">
      <div className="sources-heading">
        <h2>
          <BookOpen size={17} />
          知识来源
        </h2>
        <button className="icon-button" onClick={() => onClose()} aria-label="关闭知识来源">
          <X size={18} />
        </button>
      </div>
      <p className="sources-description">回答所引用的资料，帮助你进一步核实。</p>
      {sources.length ? (
        sources.map((citation, i) => (
          <div className="citation-card" key={citation.chunkId}>
            <span className="citation-number">{String(i + 1).padStart(2, '0')}</span>
            <strong>{citation.title}</strong>
            <p>知识文档 · {citation.documentId}</p>
            {safeSource(citation.source) && (
              <a href={safeSource(citation.source)} target="_blank" rel="noreferrer">
                {new URL(citation.source!).hostname}
                <ExternalLink size={12} />
              </a>
            )}
            <div className="verified-label">
              <Check size={12} />
              引用已校验
            </div>
          </div>
        ))
      ) : (
        <div className="sources-empty">
          <BookOpen size={27} />
          <p>回答引用的资料会显示在这里。</p>
          <span>先发送一个问题，开始查找答案。</span>
        </div>
      )}
      <div className="sources-footer">
        <ShieldCheck size={15} />
        知识依据与个人记忆分开管理
      </div>
    </aside>
  );
}
