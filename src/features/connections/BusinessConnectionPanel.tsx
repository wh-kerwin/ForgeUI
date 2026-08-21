import { ChangeEvent, useRef } from "react";
import { Database, FileJson, Plus, Upload } from "lucide-react";
import type { SetStateAction } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";

type Props = {
  spec: OpenApiSummary | null;
  auth: BusinessAuth;
  secret: string;
  onImport: () => void;
  onImportFile: (file: File) => void;
  onAuthChange: (value: SetStateAction<BusinessAuth>) => void;
  onSecretChange: (value: string) => void;
  onSaveAuth: () => void;
};

export function BusinessConnectionPanel({
  spec,
  auth: businessAuth,
  secret: businessSecret,
  onImport: importSwagger,
  onImportFile,
  onAuthChange: setBusinessAuth,
  onSecretChange: setBusinessSecret,
  onSaveAuth: saveBusinessAuth,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onImportFile(file);
    event.target.value = "";
  };
  return (
    <div className="panel connections" id="business-connection">
      <div className="panel-head">
        <div>
          <span className="eyebrow">DATA SOURCES</span>
          <h3>业务连接</h3>
        </div>
        <button className="icon-btn" onClick={importSwagger}>
          <Plus size={17} />
        </button>
      </div>
      {spec ? (
        <>
          <div className="connection-card">
            <div className="source-icon">
              <FileJson size={17} />
            </div>
            <div>
              <strong>{spec.title}</strong>
              <span>
                {spec.spec_version} · {spec.operation_count} operations
              </span>
            </div>
            <span className="connected">已导入</span>
          </div>
          <div className="operation-list">
            {spec.operations?.map((operation) => (
              <label key={operation} className="operation-option">
                <input type="checkbox" checked={businessAuth.authorizedOperations?.includes(operation) || false} onChange={(event) => setBusinessAuth((current) => ({ ...current, authorizedOperations: event.target.checked ? [...(current.authorizedOperations || []), operation] : (current.authorizedOperations || []).filter((item) => item !== operation) }))} />
                <span>{operation}</span>
              </label>
            ))}
          </div>
          <p className="muted">勾选后保存，只有授权过的 operation 可由生成页面调用。</p>
        </>
      ) : (
        <div className="connection-card">
          <div className="source-icon">
            <Database size={17} />
          </div>
          <div>
            <strong>尚未导入业务服务</strong>
            <span>支持 Swagger/OpenAPI URL</span>
          </div>
        </div>
      )}
      <button className="add-row" onClick={importSwagger}>
        <Plus size={15} />
        添加 Swagger / OpenAPI 地址
      </button>
      <input ref={fileInput} type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" hidden onChange={handleFile} />
      <button className="add-row" onClick={() => fileInput.current?.click()}>
        <Upload size={15} />
        导入本地 JSON / YAML 文件
      </button>
      <div className="auth-box">
        <span className="eyebrow">UPSTREAM AUTH</span>
        <input
          type="url"
          placeholder="业务 API 基址，例如 https://api.example.com/v1"
          value={businessAuth.apiBaseUrl || ""}
          onChange={(event) => setBusinessAuth((current) => ({ ...current, apiBaseUrl: event.target.value }))}
        />
        <select
          value={businessAuth.type}
          onChange={(e) =>
            setBusinessAuth((v) => ({ ...v, type: e.target.value }))
          }
        >
          <option value="none">无认证</option>
          <option value="bearer">Bearer Token</option>
          <option value="apiKey">API Key</option>
        </select>
        {businessAuth.type === "apiKey" && (
          <input
            placeholder="Header 名称"
            value={businessAuth.apiKeyName}
            onChange={(e) =>
              setBusinessAuth((v) => ({
                ...v,
                apiKeyName: e.target.value,
              }))
            }
          />
        )}{" "}
        {businessAuth.type !== "none" && (
          <>
            <input
              type="password"
              placeholder="凭证（保存到系统钥匙串）"
              value={businessSecret}
              onChange={(e) => setBusinessSecret(e.target.value)}
            />
            <button className="secondary" onClick={saveBusinessAuth}>
              保存凭证
            </button>
          </>
        )}
        <textarea
          className="ca-input"
          placeholder="可选：粘贴企业 CA PEM（不会关闭 TLS 校验）"
          value={businessAuth.caPem}
          onChange={(e) =>
            setBusinessAuth((v) => ({ ...v, caPem: e.target.value }))
          }
        />
      </div>
    </div>
  );
}
