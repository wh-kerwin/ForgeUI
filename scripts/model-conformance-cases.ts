export const CONFORMANCE_CASE_KEYS = ["dashboard", "crud", "enterprise-theme"] as const;

export type ConformanceCaseKey = (typeof CONFORMANCE_CASE_KEYS)[number];

export type ConformanceCaseDefinition = {
  key: ConformanceCaseKey;
  prompt: string;
  templateId: "dashboard" | "crud";
  variant: number;
};

export type ConformanceFailureCategory = "rate-limit" | "timeout" | "unavailable" | "auth" | "invalid-output" | "provider-error";

const PROMPTS: Record<ConformanceCaseKey, string[]> = {
  dashboard: [
    "基于设备接口生成运营 Dashboard，包含状态统计与趋势图。",
    "请用这些设备 API 生成管理驾驶舱，突出关键指标和状态趋势。",
    "生成设备运营概览，需要统计卡片、趋势图和可回退的数据列表。",
    "Build a device operations dashboard with decision-ready metrics, status trends, and a list fallback.",
    "Create an API-backed device overview focused on summary statistics and a time-series chart.",
  ],
  crud: [
    "基于设备接口生成 CRUD 管理页，支持查询、新增、编辑、详情和删除。",
    "生成设备维护页面，将真实接口分别绑定到列表、详情、创建、更新和删除操作。",
    "请创建可搜索的设备管理页，包含安全的增删改查流程。",
    "Build a searchable device manager with authorized create, edit, detail, and delete actions.",
    "Create an API-backed CRUD workspace and bind every action to the matching allowed operation.",
  ],
  "enterprise-theme": [
    "基于设备接口生成企业蓝风格管理页，主题必须使用 enterprise-blue。",
    "请创建企业级蓝白风格的设备后台，并将 PageSpec theme 设置为 enterprise-blue。",
    "生成设备管理页面，视觉采用企业蓝主题，输出中的 theme 必须是 enterprise-blue。",
    "设备运营后台需要类似 Ant Design Pro 的企业蓝白观感，请使用 enterprise-blue 主题。",
    "请把这组设备 API 做成企业蓝风格业务界面，不要使用默认暗色主题。",
    "Build an enterprise-blue device administration page and set the PageSpec theme to enterprise-blue.",
    "Create a blue-and-white enterprise management UI for the device APIs; the required theme is enterprise-blue.",
    "Use an Ant Design Pro-like enterprise blue visual style and emit theme: enterprise-blue.",
    "Generate an internal device operations screen with the explicit enterprise-blue theme.",
    "The device manager must use the enterprise blue preset rather than forge-default; return enterprise-blue as its theme.",
  ],
};

const CASE_PATTERN: ConformanceCaseKey[] = [
  "dashboard",
  "enterprise-theme",
  "crud",
  "enterprise-theme",
  "dashboard",
  "crud",
  "enterprise-theme",
  "dashboard",
  "crud",
  "enterprise-theme",
];

export function createConformanceCases(count: number): ConformanceCaseDefinition[] {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("Conformance case count must be an integer from 1 to 200");
  }
  const occurrences: Record<ConformanceCaseKey, number> = {
    dashboard: 0,
    crud: 0,
    "enterprise-theme": 0,
  };
  return Array.from({ length: count }, (_, index) => {
    const key = CASE_PATTERN[index % CASE_PATTERN.length];
    const variant = occurrences[key] % PROMPTS[key].length;
    occurrences[key] += 1;
    return {
      key,
      prompt: PROMPTS[key][variant],
      templateId: key === "dashboard" ? "dashboard" : "crud",
      variant: variant + 1,
    };
  });
}

export function conformanceCaseDistribution(cases: ConformanceCaseDefinition[]) {
  return Object.fromEntries(
    CONFORMANCE_CASE_KEYS.map((key) => [key, cases.filter((testCase) => testCase.key === key).length]),
  ) as Record<ConformanceCaseKey, number>;
}

export function classifyConformanceFailure(error: unknown): ConformanceFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b429\b|too many requests|rate.?limit|限流|请求频繁/i.test(message)) return "rate-limit";
  if (/timed?\s*out|timeout|超时/i.test(message)) return "timeout";
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|api.?key|凭证|鉴权/i.test(message)) return "auth";
  if (/PageSpec|JSON|schema|模型输出|不符合|解析|响应不完整|未生成可执行页面|operation binding/i.test(message)) return "invalid-output";
  if (/\b(408|425|500|502|503|504)\b|temporar|unavailable|connection|network|reset|模型请求失败|连接失败|服务繁忙|过载/i.test(message)) return "unavailable";
  return "provider-error";
}

export function isRetryableConformanceFailure(category: ConformanceFailureCategory) {
  return category === "rate-limit" || category === "timeout" || category === "unavailable";
}

export function conformanceThresholdStatus(passed: number, attempted: number, total: number, threshold = 0.95) {
  if (![passed, attempted, total].every(Number.isInteger) || passed < 0 || attempted < passed || total < attempted) {
    throw new Error("Conformance counts must satisfy 0 <= passed <= attempted <= total");
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error("Conformance threshold must be greater than 0 and at most 1");
  }
  if (total === 0) return { reachable: true, requiredPasses: 0, maximumPasses: 0, maximumRate: 1 };
  const requiredPasses = Math.ceil(total * threshold);
  const maximumPasses = passed + total - attempted;
  return {
    reachable: maximumPasses >= requiredPasses,
    requiredPasses,
    maximumPasses,
    maximumRate: maximumPasses / total,
  };
}
