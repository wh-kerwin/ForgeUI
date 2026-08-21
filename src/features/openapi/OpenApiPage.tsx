import { ChangeEvent, useRef, type ReactNode } from "react";
import { FileJson, Plus, Upload } from "lucide-react";
import type { SetStateAction } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";

type Props = { spec: OpenApiSummary | null; auth: BusinessAuth; onImport: () => void; onImportFile: (file: File) => void; onAuthChange: (value: SetStateAction<BusinessAuth>) => void; onSave: () => void };
export function OpenApiPage({ spec, auth, onImport, onImportFile, onAuthChange, onSave }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) onImportFile(file); e.target.value = ""; };
  return <PageLayout eyebrow="OPENAPI CATALOG" title="OpenAPI 文档" intro="导入 Swagger/OpenAPI 规范，选择允许生成页面调用的 operation。">
    <section className="panel route-panel">
      <div className="panel-head"><div><span className="eyebrow">SPECIFICATION</span><h3>接口文档</h3></div><button className="icon-btn" onClick={onImport}><Plus size={17}/></button></div>
      {spec ? <><div className="connection-card"><div className="source-icon"><FileJson size={17}/></div><div><strong>{spec.title}</strong><span>{spec.spec_version} · {spec.operation_count} operations</span></div><span className="connected">已导入</span></div><div className="operation-list">{spec.operations?.map(op => <label key={op} className="operation-option"><input type="checkbox" checked={auth.authorizedOperations?.includes(op) || false} onChange={e => onAuthChange(cur => ({...cur, authorizedOperations: e.target.checked ? [...(cur.authorizedOperations || []), op] : (cur.authorizedOperations || []).filter(x => x !== op)}))}/><span>{op}</span></label>)}</div><p className="muted">只有勾选并保存的 operation 才允许生成页面调用。</p></> : <div className="empty-state">尚未导入 OpenAPI 规范</div>}
      <button className="add-row" onClick={onImport}><Plus size={15}/> 添加 Swagger / OpenAPI 地址</button>
      <input ref={fileInput} type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" hidden onChange={handleFile}/><button className="add-row" onClick={() => fileInput.current?.click()}><Upload size={15}/> 导入本地 JSON / YAML 文件</button><button className="primary" onClick={onSave}>保存文档授权</button>
    </section>
  </PageLayout>;
}
export function PageLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) { return <main className="route-main"><header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div></header><div className="page-content">{children}</div></main>; }
