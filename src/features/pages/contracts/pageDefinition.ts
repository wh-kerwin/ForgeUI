import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import { pageIssue, type PageIssue } from "../pageIssues";
import { parsePageSpecDetailed } from "../parsePageSpec";
import type { PageSpec } from "../../../types/domain";
import type { ForgeUIPageDefinitionV2 } from "../../../types/generated/pageDefinitionV2";
import { pageDefinitionV2Schema } from "../../../types/generated/pageDefinitionV2Schema";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(pageDefinitionV2Schema);

export type PageDefinitionValidation = {
  definition: ForgeUIPageDefinitionV2 | null;
  issues: PageIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const safePattern = (pattern: string) => {
  const match = /^\^\[(0-9|A-Za-z|A-Za-z0-9|A-Za-z0-9_-)\]\{([0-9]+)(?:,([0-9]+))?\}\$$/.exec(
    pattern,
  );
  if (!match) return null;
  const min = Number(match[2]);
  const max = Number(match[3] ?? match[2]);
  if (min > max || max > 10000) return null;
  return { min, max, characters: match[1] };
};

function matchesSafePattern(value: string, pattern: NonNullable<ReturnType<typeof safePattern>>) {
  return (
    value.length >= pattern.min &&
    value.length <= pattern.max &&
    [...value].every(
      (char) =>
        (pattern.characters !== "A-Za-z" && char >= "0" && char <= "9") ||
        (pattern.characters !== "0-9" &&
          ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z"))) ||
        (pattern.characters === "A-Za-z0-9_-" && (char === "_" || char === "-")),
    )
  );
}

function issueFor(error: ErrorObject): PageIssue {
  const path = error.instancePath || "/";
  return pageIssue(
    "PAGE_V2_SCHEMA_INVALID",
    path,
    "schema",
    "页面定义不符合 v2 契约；请检查字段、数量或引用",
  );
}

/** Bound work before AJV follows recursive view references. Count occurrences, not identities. */
function inputIssue(value: unknown): PageIssue | undefined {
  const active = new WeakSet<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    const current = entry.value;
    if (entry.exit) {
      active.delete(current as object);
      continue;
    }
    if (++nodes > 20000 || entry.depth > 32) {
      return pageIssue(
        "PAGE_V2_INPUT_LIMIT_EXCEEDED",
        "/",
        "schema",
        "页面定义超过输入深度或节点预算",
      );
    }
    if (current === null || typeof current !== "object") continue;
    if (active.has(current)) {
      return pageIssue("PAGE_V2_INPUT_CYCLE", "/", "schema", "页面定义不能包含循环引用");
    }
    active.add(current);
    stack.push({ value: current, depth: entry.depth, exit: true });
    const keys = Object.keys(current);
    if (keys.length + nodes + stack.length > 20000) {
      return pageIssue(
        "PAGE_V2_INPUT_LIMIT_EXCEEDED",
        "/",
        "schema",
        "页面定义超过输入深度或节点预算",
      );
    }
    for (const key of keys)
      stack.push({ value: (current as Record<string, unknown>)[key], depth: entry.depth + 1 });
  }
}

/** Named metrics: a bounded page aggregate or an explicitly bound stats endpoint, never both. */
function metricIssues(definition: ForgeUIPageDefinitionV2): PageIssue[] {
  const issues: PageIssue[] = [];
  const metrics = definition.metrics ?? [];
  const fieldKeys = new Set(definition.fields.map((field) => field.key));
  const seen = new Set<string>();
  metrics.forEach((metric, index) => {
    const path = `/metrics/${index}`;
    if (seen.has(metric.key))
      issues.push(
        pageIssue(
          "PAGE_V2_DUPLICATE_METRIC_KEY",
          `${path}/key`,
          "reference",
          "统计指标 key 必须唯一",
        ),
      );
    seen.add(metric.key);
    const mixed = (field: string) =>
      issues.push(
        pageIssue(
          "PAGE_V2_METRIC_SCOPE_MIXED",
          `${path}/${field}`,
          "reference",
          "当前页聚合与服务端统计绑定不能混用",
        ),
      );
    if (metric.scope === "currentPage") {
      if (!metric.aggregation)
        issues.push(
          pageIssue(
            "PAGE_V2_METRIC_AGGREGATION_MISSING",
            `${path}/aggregation`,
            "reference",
            "当前页聚合必须声明聚合方式",
          ),
        );
      else if (
        metric.aggregation !== "count" &&
        (!metric.fieldKey || !fieldKeys.has(metric.fieldKey))
      )
        issues.push(
          pageIssue(
            "PAGE_V2_METRIC_FIELD_INVALID",
            `${path}/fieldKey`,
            "reference",
            "聚合字段必须引用已定义字段",
          ),
        );
      if (metric.operationRef !== undefined) mixed("operationRef");
      if (metric.valuePointer !== undefined) mixed("valuePointer");
    } else {
      if (!metric.operationRef || !metric.valuePointer)
        issues.push(
          pageIssue(
            "PAGE_V2_METRIC_UNBOUND",
            path,
            "binding",
            "全量统计必须绑定统计操作与取值指针",
          ),
        );
      if (metric.operationRef !== undefined) {
        const operation = definition.operations.find(
          (candidate) => candidate.key === metric.operationRef,
        );
        if (!operation)
          issues.push(
            pageIssue(
              "PAGE_V2_METRIC_OPERATION_REFERENCE_INVALID",
              `${path}/operationRef`,
              "reference",
              "统计指标必须引用已定义操作",
            ),
          );
        else if (!["stat", "stats", "read"].includes(operation.role))
          issues.push(
            pageIssue(
              "PAGE_V2_METRIC_OPERATION_ROLE_INVALID",
              `${path}/operationRef`,
              "reference",
              "统计指标必须引用统计类操作",
            ),
          );
      }
      if (metric.aggregation !== undefined) mixed("aggregation");
      if (metric.fieldKey !== undefined) mixed("fieldKey");
    }
  });
  return issues;
}

function referenceIssues(definition: ForgeUIPageDefinitionV2): PageIssue[] {
  const issues: PageIssue[] = [];
  const fields = definition.fields;
  const fieldKeys = new Set(fields.map((field) => field.key));
  fields.forEach((field, index) => {
    const values = field.enumValues ?? [];
    if (
      field.type === "enum"
        ? values.length === 0 || new Set(values).size !== values.length
        : field.enumValues !== undefined
    )
      issues.push(
        pageIssue(
          "PAGE_V2_ENUM_VALUES_INVALID",
          `/fields/${index}/enumValues`,
          "reference",
          "enum 必须提供非空唯一 enumValues，其他类型不能提供",
        ),
      );
  });
  const operationKeys = new Set(definition.operations.map((operation) => operation.key));
  const viewKeys = new Set<string>();

  const unique = (items: string[], path: string, code: string, label: string) => {
    const seen = new Set<string>();
    items.forEach((key, index) => {
      if (seen.has(key)) {
        issues.push(pageIssue(code, `${path}/${index}/key`, "reference", `${label} key 必须唯一`));
      }
      seen.add(key);
    });
  };
  unique(
    fields.map((field) => field.key),
    "/fields",
    "PAGE_V2_DUPLICATE_FIELD_KEY",
    "字段",
  );
  unique(
    definition.operations.map((operation) => operation.key),
    "/operations",
    "PAGE_V2_DUPLICATE_OPERATION_KEY",
    "操作",
  );

  unique(
    definition.filters.map((filter) => filter.key),
    "/filters",
    "PAGE_V2_DUPLICATE_FILTER_KEY",
    "筛选器",
  );
  definition.operations.forEach((operation, index) => {
    const path = `/operations/${index}`;
    const allowed =
      operation.role === "create"
        ? ["POST"]
        : operation.role === "update"
          ? ["PUT", "PATCH"]
          : operation.role === "delete" || operation.role === "batch"
            ? operation.role === "delete"
              ? ["DELETE"]
              : ["POST", "DELETE"]
            : ["GET"];
    if (!allowed.includes(operation.method)) {
      issues.push(
        pageIssue(
          "PAGE_V2_OPERATION_METHOD_INVALID",
          `${path}/method`,
          "reference",
          "操作方法与角色不匹配",
        ),
      );
    }
    const body = operation.bodySchema ?? [];
    unique(
      body.map((field) => field.key),
      `${path}/bodySchema`,
      "PAGE_V2_DUPLICATE_BODY_FIELD_KEY",
      "请求字段",
    );
    body.forEach((field, fieldIndex) => {
      const c = field.constraints;
      const fieldPath = `${path}/bodySchema/${fieldIndex}`;
      const allowed = [
        "nullable",
        "readonly",
        ...(["number", "integer"].includes(field.type)
          ? ["min", "max"]
          : ["string", "enum"].includes(field.type)
            ? ["minLength", "maxLength", "pattern"]
            : []),
      ];
      if (c && Object.keys(c).some((key) => !allowed.includes(key)))
        issues.push(
          pageIssue(
            "PAGE_V2_CONSTRAINT_TYPE_INVALID",
            `${fieldPath}/constraints`,
            "reference",
            "约束与字段类型不相容",
          ),
        );
      if (
        field.type === "integer" &&
        c?.min !== undefined &&
        c.max !== undefined &&
        c.min <= c.max &&
        Math.ceil(c.min) > Math.floor(c.max)
      )
        issues.push(
          pageIssue(
            "PAGE_V2_CONSTRAINT_RANGE_INVALID",
            `${fieldPath}/constraints`,
            "reference",
            "integer 区间必须包含整数",
          ),
        );
      if (
        c &&
        ((c.min !== undefined && c.max !== undefined && c.min > c.max) ||
          (c.minLength !== undefined && c.maxLength !== undefined && c.minLength > c.maxLength))
      ) {
        issues.push(
          pageIssue(
            "PAGE_V2_CONSTRAINT_RANGE_INVALID",
            `${path}/bodySchema/${fieldIndex}/constraints`,
            "reference",
            "约束下限不能大于上限",
          ),
        );
      }
      if (c?.pattern !== undefined && !safePattern(c.pattern))
        issues.push(
          pageIssue(
            "PAGE_V2_PATTERN_INVALID",
            `${path}/bodySchema/${fieldIndex}/constraints/pattern`,
            "reference",
            "pattern 必须是受限的锚定单字符类模式",
          ),
        );
      if (field.type === "enum") {
        const values = field.enumValues ?? [];
        if (values.length === 0 || new Set(values).size !== values.length)
          issues.push(
            pageIssue(
              "PAGE_V2_ENUM_VALUES_INVALID",
              `${path}/bodySchema/${fieldIndex}/enumValues`,
              "reference",
              "enumValues 必须非空且唯一",
            ),
          );
        const pattern = c?.pattern === undefined ? null : safePattern(c.pattern);
        if (
          values.some(
            (value) =>
              (c?.minLength !== undefined && [...value].length < c.minLength) ||
              (c?.maxLength !== undefined && [...value].length > c.maxLength) ||
              (pattern && !matchesSafePattern(value, pattern)),
          )
        )
          issues.push(
            pageIssue(
              "PAGE_V2_ENUM_CONSTRAINT_INVALID",
              `${fieldPath}/enumValues`,
              "reference",
              "枚举值必须满足自身约束",
            ),
          );
      } else if (field.enumValues !== undefined) {
        issues.push(
          pageIssue(
            "PAGE_V2_ENUM_VALUES_INVALID",
            `${path}/bodySchema/${fieldIndex}/enumValues`,
            "reference",
            "非 enum 字段不能提供 enumValues",
          ),
        );
      }
    });
    const mapping = operation.parameterMapping;
    const pathParams = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const pathMappings = mapping?.path ?? [];
    const bodyMappings = mapping?.body ?? [];
    const validateMappings = (
      entries: { param: string; fieldKey?: string; bodyFieldKey?: string }[],
      key: "path" | "body",
    ) => {
      const seen = new Set<string>();
      entries.forEach((entry, entryIndex) => {
        const entryPath = `${path}/parameterMapping/${key}/${entryIndex}`;
        if (seen.has(entry.param))
          issues.push(
            pageIssue(
              "PAGE_V2_PARAMETER_MAPPING_DUPLICATE",
              `${entryPath}/param`,
              "reference",
              "参数映射目标必须唯一",
            ),
          );
        seen.add(entry.param);
        if (key === "path" && !pathParams.includes(entry.param))
          issues.push(
            pageIssue(
              "PAGE_V2_PARAMETER_MAPPING_PATH_INVALID",
              `${entryPath}/param`,
              "reference",
              "path 映射参数必须对应路径占位符",
            ),
          );
        const ref = key === "path" ? entry.fieldKey : entry.bodyFieldKey;
        if (key === "path" ? !fieldKeys.has(ref!) : !body.some((field) => field.key === ref))
          issues.push(
            pageIssue(
              "PAGE_V2_PARAMETER_MAPPING_REFERENCE_INVALID",
              `${entryPath}/${key === "path" ? "fieldKey" : "bodyFieldKey"}`,
              "reference",
              "参数映射必须引用已定义字段",
            ),
          );
      });
    };
    if (mapping) {
      validateMappings(pathMappings, "path");
      validateMappings(bodyMappings, "body");
      const mappedParams = new Set(pathMappings.map((entry) => entry.param));
      pathParams.forEach((param) => {
        if (!mappedParams.has(param))
          issues.push(
            pageIssue(
              "PAGE_V2_PARAMETER_MAPPING_PATH_MISSING",
              `${path}/parameterMapping/path`,
              "reference",
              "每个路径占位符都必须有参数映射",
            ),
          );
      });
    } else if (pathParams.length > 0) {
      issues.push(
        pageIssue(
          "PAGE_V2_PARAMETER_MAPPING_PATH_MISSING",
          `${path}/parameterMapping/path`,
          "reference",
          "包含路径占位符的操作必须提供参数映射",
        ),
      );
    }
    if (operation.role === "batch") {
      if (!operation.batch)
        issues.push(
          pageIssue(
            "PAGE_V2_BATCH_REQUIRED",
            `${path}/batch`,
            "reference",
            "batch role 必须提供 batch",
          ),
        );
      else {
        if (operation.method !== "POST" && operation.method !== "DELETE")
          issues.push(
            pageIssue(
              "PAGE_V2_OPERATION_METHOD_INVALID",
              `${path}/method`,
              "reference",
              "batch 操作仅允许 POST 或 DELETE",
            ),
          );
        if (!fieldKeys.has(operation.batch.idsFieldKey))
          issues.push(
            pageIssue(
              "PAGE_V2_BATCH_FIELD_REFERENCE_INVALID",
              `${path}/batch/idsFieldKey`,
              "reference",
              "batch idsFieldKey 必须引用字段",
            ),
          );
        const target = operation.batch.target;
        if (bodyMappings.some((entry) => entry.param === target.param))
          issues.push(
            pageIssue(
              "PAGE_V2_BATCH_TARGET_CONFLICT",
              `${path}/batch/target/param`,
              "reference",
              "batch 与普通 body 映射不能具有相同目标",
            ),
          );
      }
    } else if (operation.batch)
      issues.push(
        pageIssue(
          "PAGE_V2_BATCH_ROLE_INVALID",
          `${path}/batch`,
          "reference",
          "提供 batch 时 role 必须为 batch",
        ),
      );
  });

  const source = definition.dataSources.primary;
  if (!operationKeys.has(source.operationRef)) {
    issues.push(
      pageIssue(
        "PAGE_V2_OPERATION_REFERENCE_INVALID",
        "/dataSources/primary/operationRef",
        "reference",
        "主数据源必须引用已定义的操作",
      ),
    );
  } else if (
    !definition.operations.some(
      (operation) => operation.key === source.operationRef && operation.role === "list",
    )
  ) {
    issues.push(
      pageIssue(
        "PAGE_V2_PRIMARY_OPERATION_NOT_LIST",
        "/dataSources/primary/operationRef",
        "reference",
        "主数据源必须引用 list 操作",
      ),
    );
  }

  definition.filters.forEach((filter, index) => {
    if (!fieldKeys.has(filter.fieldKey)) {
      issues.push(
        pageIssue(
          "PAGE_V2_FIELD_REFERENCE_INVALID",
          `/filters/${index}/fieldKey`,
          "reference",
          "筛选器必须引用已定义字段",
        ),
      );
    }
  });

  const walkView = (
    view: ForgeUIPageDefinitionV2["views"][number],
    path: string,
    depth: number,
  ) => {
    if (depth > 3) {
      issues.push(
        pageIssue("PAGE_V2_VIEW_DEPTH_EXCEEDED", path, "reference", "视图嵌套深度不能超过 3"),
      );
      return;
    }
    if (viewKeys.has(view.key)) {
      issues.push(
        pageIssue("PAGE_V2_DUPLICATE_VIEW_KEY", `${path}/key`, "reference", "视图 key 必须唯一"),
      );
    }
    viewKeys.add(view.key);
    const refs: string[] =
      view.type === "list"
        ? [...view.fieldKeys, ...(view.defaultSort ? [view.defaultSort.fieldKey] : [])]
        : view.type === "chart"
          ? [
              view.xFieldKey,
              view.yFieldKey,
              ...(view.groupByFieldKey ? [view.groupByFieldKey] : []),
            ]
          : view.type === "kanban"
            ? [view.groupFieldKey, ...view.cardFieldKeys]
            : [];
    refs.forEach((key) => {
      if (!fieldKeys.has(key)) {
        issues.push(
          pageIssue("PAGE_V2_FIELD_REFERENCE_INVALID", path, "reference", "视图必须引用已定义字段"),
        );
      }
    });
    if (view.type === "tabs") {
      unique(
        view.items.map((item) => item.key),
        `${path}/items`,
        "PAGE_V2_DUPLICATE_TAB_ITEM_KEY",
        "标签项",
      );
      view.items.forEach((item, index) =>
        walkView(item.view, `${path}/items/${index}/view`, depth + 1),
      );
    }
    if (view.type === "split") {
      walkView(view.left, `${path}/left`, depth + 1);
      walkView(view.right, `${path}/right`, depth + 1);
    }
  };
  definition.views.forEach((view, index) => walkView(view, `/views/${index}`, 1));
  return issues;
}

/** Schema is followed by semantic reference checks; no input is repaired. */
export function validateV2PageDefinition(value: unknown): PageDefinitionValidation {
  const budgetIssue = inputIssue(value);
  if (budgetIssue) return { definition: null, issues: [budgetIssue] };
  if (!validateSchema(value)) {
    return {
      definition: null,
      issues: (validateSchema.errors ?? []).map(issueFor),
    };
  }
  const definition = value as ForgeUIPageDefinitionV2;
  const issues = [...referenceIssues(definition), ...metricIssues(definition)];
  return { definition: issues.length === 0 ? definition : null, issues };
}

/** Explicit version dispatcher; absent versions remain owned by the v1 parser. */
export function validatePageDefinition(value: unknown): {
  definition: ForgeUIPageDefinitionV2 | PageSpec | null;
  issues: PageIssue[];
} {
  if (isRecord(value) && (value.version === undefined || value.version === 1)) {
    const result = parsePageSpecDetailed(value);
    return { definition: result.page, issues: result.issues };
  }
  if (!isRecord(value) || value.version !== 2) {
    return {
      definition: null,
      issues: [
        pageIssue(
          "PAGE_VERSION_UNSUPPORTED",
          "/version",
          "schema",
          "此入口仅接受 version 2 页面定义；v1 请使用兼容解析器",
        ),
      ],
    };
  }
  return validateV2PageDefinition(value);
}
