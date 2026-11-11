import { Button } from "antd";
import { PageExportActions } from "./PageExportActions";
import type { PageSpec, ThemeStyle } from "../../types/domain";
import { ChevronRight, Plus, RefreshCw } from "lucide-react";
import { SelectField } from "../../components/SelectField";

export function PageHeader({
  page,
  projectId,
  apiDocumentIds,
  isStreaming,
  modelId,
  templateId,
  templateName,
  zh,
  onSaved,
  onCreate,
  theme,
  onThemeChange,
  onLoadData,
  loadingData,
  showPageActions = true,
  displayColumns,
  displayRows,
  dataScope,
}: {
  page: PageSpec;
  projectId: string;
  apiDocumentIds: string[];
  isStreaming: boolean;
  modelId?: string;
  templateId?: string;
  templateName?: string;
  zh: boolean;
  onSaved: () => void;
  onCreate?: () => void;
  theme: ThemeStyle;
  onThemeChange: (theme: ThemeStyle) => void;
  onLoadData?: () => void;
  loadingData?: boolean;
  showPageActions?: boolean;
  displayColumns?: string[];
  displayRows?: string[][];
  dataScope?: "current-page" | "definition-sample";
}) {
  return (
    <div className="panel-head">
      <div>
        {page.breadcrumb?.length ? (
          <nav className="page-breadcrumb" aria-label={zh ? "面包屑" : "Breadcrumb"}>
            {page.breadcrumb.map((item, index) => (
              <span key={`${item}-${index}`}>
                {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                {item}
              </span>
            ))}
          </nav>
        ) : null}
        <span className="eyebrow">GENERATED PAGE · UI DSL v1</span>
        <h3>{page.title}</h3>
        <p className="muted">{page.description}</p>
      </div>
      {isStreaming ? (
        <span className="streaming-status">
          <span />
          {zh ? "生成中…" : "Generating…"}
        </span>
      ) : (
        <div className="page-header-actions">
          <SelectField
            className="theme-select"
            value={theme}
            options={[
              { value: "forge-default", label: zh ? "暗色默认" : "Dark default" },
              { value: "enterprise-blue", label: zh ? "企业蓝白" : "Enterprise blue" },
              { value: "clean-light", label: zh ? "干净浅色" : "Clean light" },
              { value: "minimal-dark", label: zh ? "极简深色" : "Minimal dark" },
            ]}
            onChange={(value) => onThemeChange(value as ThemeStyle)}
            ariaLabel={zh ? "切换页面主题" : "Switch page theme"}
          />
          {onLoadData && (
            <Button icon={<RefreshCw size={14} />} loading={loadingData} onClick={onLoadData}>
              {loadingData ? (zh ? "加载中" : "Loading") : zh ? "加载真实数据" : "Load real data"}
            </Button>
          )}
          {onCreate && (
            <Button type="primary" icon={<Plus size={14} />} onClick={onCreate}>
              {zh ? "新增" : "New"}
            </Button>
          )}
          {showPageActions && (
            <PageExportActions
              page={page}
              projectId={projectId}
              apiDocumentIds={apiDocumentIds}
              modelId={modelId}
              templateId={templateId}
              templateName={templateName}
              onSaved={onSaved}
              displayColumns={displayColumns}
              displayRows={displayRows}
              dataScope={dataScope}
            />
          )}
        </div>
      )}
    </div>
  );
}
