import { useState } from "react";
import { KeyRound, Wifi, X } from "lucide-react";
import type { ModelConfig } from "../../types/domain";

type Props = {
  initial?: ModelConfig;
  onClose: () => void;
  onSave: (model: ModelConfig) => void;
  onTest: (model: ModelConfig) => void;
  testing: boolean;
};
const emptyModel = (): ModelConfig => ({
  id: crypto.randomUUID(),
  name: "",
  protocol: "openai",
  baseUrl: "",
  model: "",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 4096,
  streaming: true,
  enabled: true,
  timeoutSeconds: 60,
  structuredOutput: "jsonObject",
  customHeaders: {},
  notes: "",
});

export function ModelEditor({
  initial,
  onClose,
  onSave,
  onTest,
  testing,
}: Props) {
  const [model, setModel] = useState<ModelConfig>({
    ...emptyModel(),
    ...initial,
    customHeaders: initial?.customHeaders || {},
    timeoutSeconds: initial?.timeoutSeconds || 60,
    structuredOutput: initial?.structuredOutput || "jsonObject",
    notes: initial?.notes || "",
  });
  const set = <K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) =>
    setModel((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">MODEL CONFIGURATION</span>
            <h2>模型服务</h2>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-intro">
          密钥仅保存到系统钥匙串；这里配置的是 AI 服务，不是业务 API。
        </p>
        <label>
          配置名称
          <input
            value={model.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="例如：本地 Qwen"
          />
        </label>
        <div className="two-col">
          <label>
            API 格式
            <select
              value={model.protocol}
              onChange={(e) =>
                set("protocol", e.target.value as ModelConfig["protocol"])
              }
            >
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic Compatible</option>
            </select>
          </label>
          <label>
            模型名称
            <input
              value={model.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
        <label>
          请求 Base URL
          <input
            value={model.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label>
          API Key
          <div className="secret-input">
            <KeyRound size={15} />
            <input
              type="password"
              value={model.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder="保存在系统钥匙串"
            />
          </div>
        </label>
        <div className="advanced-config">
          <span className="eyebrow">ADVANCED OPTIONS</span>
          <div className="two-col">
            <label>
              请求超时（秒）
              <input type="number" min="5" max="120" value={model.timeoutSeconds} onChange={(e) => set("timeoutSeconds", Number(e.target.value))} />
            </label>
            <label>
              结构化输出
              <select value={model.structuredOutput} onChange={(e) => set("structuredOutput", e.target.value as ModelConfig["structuredOutput"]) }>
                <option value="jsonSchema">JSON Schema</option>
                <option value="jsonObject">JSON Object</option>
                <option value="prompt">严格提示词兜底</option>
              </select>
            </label>
          </div>
          <div className="two-col">
            <label>
              Temperature
              <input type="number" min="0" max="2" step=".1" value={model.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
            </label>
            <label>
              最大输出 Token
              <input type="number" min="256" max="32768" value={model.maxTokens} onChange={(e) => set("maxTokens", Number(e.target.value))} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={model.streaming} onChange={(e) => set("streaming", e.target.checked)} />
            启用流式输出
          </label>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => onTest(model)}>
            <Wifi size={15} />
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button
            className="primary"
            disabled={!model.name || !model.baseUrl || !model.model}
            onClick={() => onSave(model)}
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
