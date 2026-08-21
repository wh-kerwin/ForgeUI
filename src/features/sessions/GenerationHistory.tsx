import type { GenerationSession, PageSpec } from "../../types/domain";

type Props = { sessions: GenerationSession[]; onOpen: (page: PageSpec) => void; onInvalid: () => void; };

export function GenerationHistory({ sessions, onOpen, onInvalid }: Props) {
  if (!sessions.length) return null;
  return <section className="template-strip"><div><span className="eyebrow">GENERATION HISTORY</span><h3>生成历史</h3></div><div className="template-list">{sessions.map((session) => <button key={session.id} className="template-chip" onClick={() => { try { onOpen(JSON.parse(session.payload) as PageSpec); } catch { onInvalid(); } }}><strong>{session.prompt}</strong><span>{session.createdAt}</span></button>)}</div></section>;
}
