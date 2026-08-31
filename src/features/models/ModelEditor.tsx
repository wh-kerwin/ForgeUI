import { useState } from "react";
import { KeyRound, Wifi, X } from "lucide-react";
import type { ModelConfig, PromptTemplate } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { SelectField } from "../../components/SelectField";

type Props = {
  initial?: ModelConfig;
  promptTemplates: PromptTemplate[];
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
  promptTemplateId: "dashboard",
  notes: "",
});

export function ModelEditor({ initial, promptTemplates, onClose, onSave, onTest, testing }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [model, setModel] = useState<ModelConfig>({
    ...emptyModel(),
    ...initial,
    customHeaders: initial?.customHeaders || {},
    timeoutSeconds: initial?.timeoutSeconds || 60,
    structuredOutput: initial?.structuredOutput || "jsonObject",
    promptTemplateId:
      initial?.promptTemplateId &&
      promptTemplates.some((template) => template.id === initial.promptTemplateId)
        ? initial.promptTemplateId
        : "dashboard",
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
            <h2>{zh ? "模型服务" : "Model service"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-intro">
          {zh
            ? "密钥仅保存到系统钥匙串；这里配置的是 AI 服务，不是业务 API。"
            : "Keys are stored only in the system keychain. This configures an AI service, not your business API."}
        </p>
        <label>
          {zh ? "配置名称" : "Configuration name"}
          <input
            value={model.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder={zh ? "例如：本地 Qwen" : "e.g. Local Qwen"}
          />
        </label>
        <div className="two-col">
          <label>
            API {zh ? "格式" : "protocol"}
            <SelectField
              value={model.protocol}
              options={[
                { value: "openai", label: "OpenAI Compatible" },
                { value: "anthropic", label: "Anthropic Compatible" },
              ]}
              onChange={(value) => set("protocol", value as ModelConfig["protocol"])}
              ariaLabel={zh ? "API 格式" : "API protocol"}
            />
          </label>
          <label>
            {zh ? "模型名称" : "Model name"}
            <input
              value={model.model}
              onChange={(event) => set("model", event.target.value)}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
        <label>
          {zh ? "请求 Base URL" : "Request Base URL"}
          <input
            value={model.baseUrl}
            onChange={(event) => set("baseUrl", event.target.value)}
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
              onChange={(event) => set("apiKey", event.target.value)}
              placeholder={zh ? "保存在系统钥匙串" : "Stored in the system keychain"}
            />
          </div>
        </label>
        <div className="advanced-config">
          <span className="eyebrow">ADVANCED OPTIONS</span>
          <div className="two-col">
            <label>
              {zh ? "请求超时（秒）" : "Request timeout (seconds)"}
              <input
                type="number"
                min="5"
                max="120"
                value={model.timeoutSeconds}
                onChange={(event) => set("timeoutSeconds", Number(event.target.value))}
              />
            </label>
            <label>
              {zh ? "结构化输出" : "Structured output"}
              <SelectField
                value={model.structuredOutput}
                options={[
                  { value: "jsonSchema", label: "JSON Schema" },
                  { value: "jsonObject", label: "JSON Object" },
                  { value: "prompt", label: zh ? "严格提示词兜底" : "Strict prompt fallback" },
                ]}
                onChange={(value) =>
                  set("structuredOutput", value as ModelConfig["structuredOutput"])
                }
                ariaLabel={zh ? "结构化输出" : "Structured output"}
              />
            </label>
          </div>
          <div className="two-col">
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step=".1"
                value={model.temperature}
                onChange={(event) => set("temperature", Number(event.target.value))}
              />
            </label>
            <label>
              {zh ? "最大输出 Token" : "Max output tokens"}
              <input
                type="number"
                min="256"
                max="32768"
                value={model.maxTokens}
                onChange={(event) => set("maxTokens", Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            {zh ? "默认 Prompt 模板" : "Default prompt template"}
            <SelectField
              value={model.promptTemplateId || "dashboard"}
              options={promptTemplates.map((template) => ({
                value: template.id,
                label: template.name,
              }))}
              onChange={(value) => set("promptTemplateId", value)}
              ariaLabel={zh ? "默认 Prompt 模板" : "Default prompt template"}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={model.streaming}
              onChange={(event) => set("streaming", event.target.checked)}
            />
            {zh ? "启用流式输出" : "Enable streaming"}
          </label>
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={() => onTest(model)}>
            <Wifi size={15} />
            {testing ? (zh ? "测试中…" : "Testing…") : zh ? "测试连接" : "Test connection"}
          </button>
          <button
            className="primary"
            disabled={!model.name || !model.baseUrl || !model.model}
            onClick={() => onSave(model)}
          >
            {zh ? "保存配置" : "Save configuration"}
          </button>
        </div>
      </div>
    </div>
  );
}
