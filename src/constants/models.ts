import type { ModelConfig } from "../types/domain";

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "default",
    name: "内部 GPT Gateway",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 4096,
    streaming: true,
    enabled: true,
    timeoutSeconds: 60,
    structuredOutput: "jsonObject",
    customHeaders: {},
    notes: "",
  },
];
