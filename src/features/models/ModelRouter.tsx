import { Bot, Copy, Settings2, Star, Trash2 } from "lucide-react";
import type { ModelConfig } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { SelectField } from "../../components/SelectField";

type Props = {
  models: ModelConfig[];
  active?: ModelConfig;
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onDuplicate: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
};

export function ModelRouter({
  models,
  active,
  selectedId,
  onSelect,
  onOpenSettings,
  onDuplicate,
  onMakeDefault,
  onDelete,
}: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return (
    <div className="panel model-panel" id="model-router">
      <div className="panel-head">
        <div>
          <span className="eyebrow">MODEL ROUTER</span>
          <h3>{zh ? "当前模型" : "Active model"}</h3>
        </div>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label={zh ? "模型设置" : "Model settings"}
        >
          <Settings2 size={17} />
        </button>
      </div>
      {active && (
        <div className="model-card">
          <div className="model-icon">
            <Bot size={18} />
          </div>
          <div className="model-info">
            <strong>{active.name}</strong>
            <span>
              {active.model} ·{" "}
              {active.protocol === "openai" ? "OpenAI Compatible" : "Anthropic Compatible"}
            </span>
          </div>
          <span className="connected">
            {active.enabled ? (zh ? "已启用" : "Enabled") : zh ? "已停用" : "Disabled"}
          </span>
        </div>
      )}
      <SelectField
        className="model-select"
        value={selectedId}
        options={models.map((model) => ({ value: model.id, label: model.name }))}
        onChange={onSelect}
        ariaLabel={zh ? "选择模型" : "Select model"}
      />
      {active && (
        <div className="model-actions">
          <button className="secondary" onClick={onDuplicate}>
            <Copy size={14} />
            {zh ? "复制" : "Duplicate"}
          </button>
          <button className="secondary" onClick={onMakeDefault}>
            <Star size={14} />
            {zh ? "设为默认" : "Make default"}
          </button>
          <button className="danger" disabled={models.length < 2} onClick={onDelete}>
            <Trash2 size={14} />
            {zh ? "删除" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}
