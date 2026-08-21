import { Bot, Copy, Settings2, Star, Trash2 } from "lucide-react";
import type { ModelConfig } from "../../types/domain";

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
  return (
    <div className="panel model-panel" id="model-router">
      <div className="panel-head">
        <div>
          <span className="eyebrow">MODEL ROUTER</span>
          <h3>当前模型</h3>
        </div>
        <button className="icon-btn" onClick={onOpenSettings}>
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
              {active.protocol === "openai"
                ? "OpenAI Compatible"
                : "Anthropic Compatible"}
            </span>
          </div>
          <span className="connected">
            {active.enabled ? "已启用" : "已停用"}
          </span>
        </div>
      )}
      <select
        className="model-select"
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      {active && (
        <div className="model-actions">
          <button className="secondary" onClick={onDuplicate}>
            <Copy size={14} />
            复制
          </button>
          <button className="secondary" onClick={onMakeDefault}>
            <Star size={14} />
            设为默认
          </button>
          <button
            className="danger"
            disabled={models.length < 2}
            onClick={onDelete}
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
    </div>
  );
}
