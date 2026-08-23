import { ChangeEvent, useRef, type ReactNode } from "react";
import { FileJson, Plus, Upload } from "lucide-react";
import type { SetStateAction } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { spec: OpenApiSummary | null; auth: BusinessAuth; onImport: () => void; onImportFile: (file: File) => void; onAuthChange: (value: SetStateAction<BusinessAuth>) => void; onSave: () => void };

export function OpenApiPage({ spec, auth, onImport, onImportFile, onAuthChange, onSave }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { language } = useLanguage();
  const zh = language === "zh";
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) onImportFile(file); event.target.value = ""; };
  return <PageLayout eyebrow="OPENAPI CATALOG" title={zh ? "OpenAPI 文档" : "OpenAPI docs"} intro={zh ? "导入 Swagger/OpenAPI 规范，选择允许生成页面调用的 operation。" : "Import a Swagger/OpenAPI spec and choose which operations generated pages may call."}>
    <section className="panel route-panel">
      <div className="panel-head"><div><span className="eyebrow">SPECIFICATION</span><h3>{zh ? "接口文档" : "API specification"}</h3></div><button className="icon-btn" onClick={onImport}><Plus size={17}/></button></div>
      {spec ? <><div className="connection-card"><div className="source-icon"><FileJson size={17}/></div><div><strong>{spec.title}</strong><span>{spec.spec_version} · {spec.operation_count} operations</span></div><span className="connected">{zh ? "已导入" : "Imported"}</span></div><div className="operation-list">{spec.operations?.map((operation) => <label key={operation} className="operation-option"><input type="checkbox" checked={auth.authorizedOperations?.includes(operation) || false} onChange={(event) => onAuthChange((current) => ({ ...current, authorizedOperations: event.target.checked ? [...(current.authorizedOperations || []), operation] : (current.authorizedOperations || []).filter((item) => item !== operation) }))}/><span>{operation}</span></label>)}</div><p className="muted">{zh ? "只有勾选并保存的 operation 才允许生成页面调用。" : "Only checked and saved operations can be called by generated pages."}</p></> : <div className="empty-state">{zh ? "尚未导入 OpenAPI 规范" : "No OpenAPI specification imported yet"}</div>}
      <button className="add-row" onClick={onImport}><Plus size={15}/> {zh ? "添加 Swagger / OpenAPI 地址" : "Add a Swagger / OpenAPI URL"}</button>
      <input ref={fileInput} type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" hidden onChange={handleFile}/><button className="add-row" onClick={() => fileInput.current?.click()}><Upload size={15}/> {zh ? "导入本地 JSON / YAML 文件" : "Import a local JSON / YAML file"}</button><button className="primary" onClick={onSave}>{zh ? "保存文档授权" : "Save operation access"}</button>
    </section>
  </PageLayout>;
}

export function PageLayout({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) { return <main className="route-main"><header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div></header><div className="page-content">{children}</div></main>; }
