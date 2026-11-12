export type EvaluationCase = {
  id: string;
  category: string;
  file: string;
  pass: boolean;
  mismatches: { field: string; expected: unknown; observed: unknown }[];
  observed: Record<string, unknown>;
};

export type EvaluationReport = {
  mode: string;
  live: string;
  total: number;
  passed: number;
  failed: number;
  layers: string[];
  minimumCases: number;
  requiredCategories: string[];
  categories: string[];
  cases: EvaluationCase[];
};

export const FIXTURE_DIR: string;
export const LIVE_REQUIRED_ENV: string;
export function isLiveRequested(argv?: string[], env?: Record<string, string | undefined>): boolean;
export function evaluateFixtures(directory?: string): Promise<EvaluationReport>;
