import { useState } from "react";
import type { GenerationSession, PageSpec } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  sessions: GenerationSession[];
  onOpen: (page: PageSpec, session: GenerationSession) => void;
  onDelete: (id: string) => void;
  onInvalid: () => void;
};

export function GenerationHistory({ sessions, onOpen, onDelete, onInvalid }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [expanded, setExpanded] = useState(false);
  if (!sessions.length) return null;
  const visibleSessions = expanded ? sessions : sessions.slice(0, 6);
  return (
    <section className="template-strip generation-history">
      <div className="history-head">
        <div>
          <span className="eyebrow">GENERATION HISTORY</span>
          <h3>{zh ? "生成历史" : "Generation history"}</h3>
        </div>
        <div className="history-head-actions">
          <span className="muted">
            {sessions.length} {zh ? "条" : "items"}
          </span>
          {sessions.length > 6 && (
            <button
              type="button"
              className="history-toggle"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (zh ? "收起" : "Collapse") : zh ? "查看全部" : "View all"}
            </button>
          )}
        </div>
      </div>
      <div className="template-list">
        {visibleSessions.map((session) => (
          <div key={session.id} className="history-item">
            <button
              className="template-chip"
              onClick={() => {
                try {
                  onOpen(JSON.parse(session.payload) as PageSpec, session);
                } catch {
                  onInvalid();
                }
              }}
            >
              <strong>{session.prompt}</strong>
              <span>{session.createdAt}</span>
            </button>
            <button
              type="button"
              className="history-delete"
              aria-label={zh ? "删除历史" : "Delete history"}
              onClick={() => onDelete(session.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
