import { ChangeEvent, useRef, type ReactNode } from "react";
import { FileJson, Pencil, Plus, Trash2, Upload } from "lucide-react";
import type { SetStateAction } from "react";
import type { ApiDocument, BusinessAuth } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  documents: ApiDocument[];
  activeDocumentId: string;
  auth: BusinessAuth | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  onImportFile: (file: File) => void;
  onAuthChange: (value: SetStateAction<BusinessAuth>) => void;
  onSave: () => void;
  onRename: (document: ApiDocument) => void;
  onToggle: (document: ApiDocument) => void;
  onDelete: (document: ApiDocument) => void;
};

export function OpenApiPage({
  documents,
  activeDocumentId,
  auth,
  onSelect,
  onImport,
  onImportFile,
  onAuthChange,
  onSave,
  onRename,
  onToggle,
  onDelete,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { language } = useLanguage();
  const zh = language === "zh";
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const spec = activeDocument?.spec ?? null;
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onImportFile(file);
    event.target.value = "";
  };
  return (
    <PageLayout
      eyebrow="OPENAPI CATALOG"
      title={zh ? "OpenAPI 文档" : "OpenAPI docs"}
      intro={
        zh
          ? "导入 Swagger/OpenAPI 规范，选择允许生成页面调用的 operation。"
          : "Import a Swagger/OpenAPI spec and choose which operations generated pages may call."
      }
    >
      <section className="panel route-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">PROJECT CATALOG</span>
            <h3>{zh ? "项目 API 文档" : "Project API documents"}</h3>
          </div>
          <button
            className="icon-btn"
            aria-label={zh ? "导入 URL" : "Import URL"}
            title={zh ? "导入 URL" : "Import URL"}
            onClick={onImport}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="api-document-list">
          {documents.map((document) => (
            <div
              className={`api-document-row ${document.id === activeDocumentId ? "active" : ""}`}
              key={document.id}
            >
              <button
                type="button"
                className="api-document-main"
                onClick={() => onSelect(document.id)}
              >
                <span className="source-icon">
                  <FileJson size={16} />
                </span>
                <span>
                  <strong>{document.name}</strong>
                  <small>
                    {document.spec.spec_version} · {document.spec.operation_count} operations
                  </small>
                </span>
              </button>
              <label
                className="document-enabled"
                title={
                  document.enabled
                    ? zh
                      ? "停用文档"
                      : "Disable document"
                    : zh
                      ? "启用文档"
                      : "Enable document"
                }
              >
                <input
                  type="checkbox"
                  checked={document.enabled}
                  onChange={() => onToggle(document)}
                />
                <span>
                  {document.enabled ? (zh ? "启用" : "Enabled") : zh ? "停用" : "Disabled"}
                </span>
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label={zh ? "重命名文档" : "Rename document"}
                title={zh ? "重命名文档" : "Rename document"}
                onClick={() => onRename(document)}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="icon-btn danger-icon"
                aria-label={zh ? "删除文档" : "Delete document"}
                title={zh ? "删除文档" : "Delete document"}
                onClick={() => onDelete(document)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {documents.length === 0 && (
            <div className="empty-state">
              {zh ? "当前项目尚未导入 OpenAPI 文档" : "No OpenAPI document in this project"}
            </div>
          )}
        </div>
        {spec && auth ? (
          <>
            <div className="document-operation-head">
              <div>
                <strong>{activeDocument?.name}</strong>
                <span>{auth.apiBaseUrl || spec.api_base_url}</span>
              </div>
              <span className={activeDocument?.enabled ? "connected" : "document-disabled"}>
                {activeDocument?.enabled
                  ? zh
                    ? "可用于生成"
                    : "Available"
                  : zh
                    ? "已停用"
                    : "Disabled"}
              </span>
            </div>
            <div className="operation-list">
              {spec.operations?.map((operation) => (
                <label key={operation} className="operation-option">
                  <input
                    type="checkbox"
                    checked={auth.authorizedOperations?.includes(operation) || false}
                    onChange={(event) =>
                      onAuthChange((current) => ({
                        ...current,
                        authorizedOperations: event.target.checked
                          ? [...(current.authorizedOperations || []), operation]
                          : (current.authorizedOperations || []).filter(
                              (item) => item !== operation,
                            ),
                      }))
                    }
                  />
                  <span>{operation}</span>
                </label>
              ))}
            </div>
            <p className="muted">
              {zh
                ? "只有勾选并保存的 operation 才能用于页面生成和运行时调用。"
                : "Only checked and saved operations can be used for generation and runtime calls."}
            </p>
            <button className="primary" onClick={onSave}>
              {zh ? "保存文档授权" : "Save operation access"}
            </button>
          </>
        ) : null}
        <button className="add-row" onClick={onImport}>
          <Plus size={15} /> {zh ? "添加 Swagger / OpenAPI 地址" : "Add a Swagger / OpenAPI URL"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
          hidden
          onChange={handleFile}
        />
        <button className="add-row" onClick={() => fileInput.current?.click()}>
          <Upload size={15} />{" "}
          {zh ? "导入本地 JSON / YAML 文件" : "Import a local JSON / YAML file"}
        </button>
      </section>
    </PageLayout>
  );
}

export function PageLayout({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="route-main">
      <header className="page-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
      </header>
      <div className="page-content">{children}</div>
    </main>
  );
}
