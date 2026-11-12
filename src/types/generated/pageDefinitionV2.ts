/* Generated from contracts/page-definition-v2.schema.json. Do not edit. */

export type Color = string;
export type Pointer = string;
export type View =
  | {
      key: string;
      type: "list";
      title?: string;
      dataSourceRef: "primary";
      /**
       * @maxItems 50
       */
      fieldKeys: string[];
      defaultSort?: Sort;
    }
  | {
      key: string;
      type: "chart";
      dataSourceRef: "primary";
      title: string;
      chartType: "bar" | "line" | "pie";
      xFieldKey: string;
      yFieldKey: string;
      groupByFieldKey?: string;
    }
  | {
      key: string;
      type: "kanban";
      dataSourceRef: "primary";
      title: string;
      groupFieldKey: string;
      /**
       * @maxItems 20
       */
      cardFieldKeys:
        | []
        | [string]
        | [string, string]
        | [string, string, string]
        | [string, string, string, string]
        | [string, string, string, string, string]
        | [string, string, string, string, string, string]
        | [string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string]
        | [string, string, string, string, string, string, string, string, string, string, string, string, string]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ]
        | [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ];
    }
  | {
      key: string;
      type: "tabs";
      /**
       * @minItems 1
       * @maxItems 10
       */
      items:
        | [
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ]
        | [
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
            {
              key: string;
              label: string;
              view: View;
            },
          ];
    }
  | {
      key: string;
      type: "split";
      left: View;
      right: View;
      splitRatio?: number;
    };

export interface ForgeUIPageDefinitionV2 {
  version: 2;
  title: string;
  description: string;
  layout?: "sidebar" | "full" | "modal";
  /**
   * @maxItems 10
   */
  breadcrumb?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string];
  permissionRole?: string;
  theme?: "forge-default" | "enterprise-blue" | "clean-light" | "minimal-dark" | "custom";
  styleTokens?: StyleTokens;
  dataSources: {
    primary: DataSource;
  };
  /**
   * @maxItems 50
   */
  fields: Field[];
  /**
   * @maxItems 20
   */
  filters:
    | []
    | [Filter]
    | [Filter, Filter]
    | [Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter, Filter]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ]
    | [
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
        Filter,
      ];
  /**
   * @maxItems 20
   */
  operations:
    | []
    | [Operation]
    | [Operation, Operation]
    | [Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation]
    | [Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation, Operation]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ]
    | [
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
        Operation,
      ];
  /**
   * @maxItems 10
   */
  views:
    | []
    | [View]
    | [View, View]
    | [View, View, View]
    | [View, View, View, View]
    | [View, View, View, View, View]
    | [View, View, View, View, View, View]
    | [View, View, View, View, View, View, View]
    | [View, View, View, View, View, View, View, View]
    | [View, View, View, View, View, View, View, View, View]
    | [View, View, View, View, View, View, View, View, View, View];
  /**
   * @maxItems 20
   */
  metrics?:
    | []
    | [Metric]
    | [Metric, Metric]
    | [Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric, Metric]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ]
    | [
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
        Metric,
      ];
}
export interface StyleTokens {
  primary?: Color;
  primaryBg?: Color;
  primaryBgHover?: Color;
  surface?: Color;
  surfaceAlt?: Color;
  surfaceControl?: Color;
  border?: Color;
  borderControl?: Color;
  focusRing?: Color;
  text?: Color;
  textMuted?: Color;
  textSubtle?: Color;
  danger?: Color;
  dangerBg?: Color;
  success?: Color;
  radius?: "none" | "sm" | "md" | "lg" | "full";
  density?: "compact" | "comfortable" | "relaxed";
}
export interface DataSource {
  operationRef: string;
  itemsPointer: Pointer;
  totalPointer?: Pointer;
  rowKeyPointer: Pointer;
}
export interface Field {
  key: string;
  label: string;
  valuePointer: Pointer;
  type: "string" | "number" | "date" | "datetime" | "enum" | "boolean" | "money";
  format?: string;
  /**
   * @minItems 1
   * @maxItems 100
   */
  enumValues?: [string, ...string[]];
}
export interface Filter {
  key: string;
  fieldKey: string;
  queryParam: string;
  operator: "eq" | "contains" | "gt" | "gte" | "lt" | "lte" | "in";
  inputType: "string" | "number" | "date" | "boolean" | "enum";
}
export interface Operation {
  key: string;
  apiDocumentId: string;
  operation_id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  role: "list" | "detail" | "create" | "update" | "delete" | "stat" | "export" | "stats" | "read" | "batch";
  /**
   * @maxItems 50
   */
  bodySchema?: BodyField[];
  parameterMapping?: ParameterMapping;
  batch?: Batch;
  confirmMessage?: string;
  sortParam?: string;
  pagination?: {
    pageParam: string;
    sizeParam: string;
    defaultSize: number;
  };
}
export interface BodyField {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "enum";
  required?: boolean;
  label?: string;
  constraints?: Constraint;
  /**
   * @minItems 1
   * @maxItems 100
   */
  enumValues?: [string, ...string[]];
}
export interface Constraint {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  readonly?: boolean;
}
export interface ParameterMapping {
  /**
   * @maxItems 50
   */
  path?: ParameterMappingEntry[];
  /**
   * @maxItems 50
   */
  body?: BodyParameterMappingEntry[];
}
export interface ParameterMappingEntry {
  param: string;
  fieldKey: string;
}
export interface BodyParameterMappingEntry {
  param: string;
  bodyFieldKey: string;
}
export interface Batch {
  type: "ids";
  dataSourceRef: "primary";
  idsFieldKey: string;
  target: {
    in: "body";
    param: string;
  };
}
export interface Sort {
  fieldKey: string;
  order: "asc" | "desc";
}
export interface Metric {
  key: string;
  label: string;
  scope: "currentPage" | "serverAggregate";
  aggregation?: "count" | "sum" | "avg" | "min" | "max";
  fieldKey?: string;
  operationRef?: string;
  valuePointer?: Pointer;
}
