/* Generated from contracts/page-definition-v2.schema.json. Do not edit. */
export const pageDefinitionV2Schema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://forge-ui.local/contracts/page-definition-v2.schema.json",
  "title": "Forge UI Page Definition v2",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "version",
    "title",
    "description",
    "dataSources",
    "fields",
    "filters",
    "operations",
    "views"
  ],
  "properties": {
    "version": {
      "const": 2
    },
    "title": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "description": {
      "type": "string",
      "maxLength": 1000
    },
    "layout": {
      "enum": [
        "sidebar",
        "full",
        "modal"
      ]
    },
    "breadcrumb": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "type": "string",
        "maxLength": 120
      }
    },
    "permissionRole": {
      "type": "string",
      "maxLength": 120
    },
    "theme": {
      "enum": [
        "forge-default",
        "enterprise-blue",
        "clean-light",
        "minimal-dark",
        "custom"
      ]
    },
    "styleTokens": {
      "$ref": "#/$defs/styleTokens"
    },
    "dataSources": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "primary"
      ],
      "properties": {
        "primary": {
          "$ref": "#/$defs/dataSource"
        }
      }
    },
    "fields": {
      "type": "array",
      "maxItems": 50,
      "items": {
        "$ref": "#/$defs/field"
      }
    },
    "filters": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "$ref": "#/$defs/filter"
      }
    },
    "operations": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "$ref": "#/$defs/operation"
      }
    },
    "views": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "$ref": "#/$defs/view"
      }
    },
    "metrics": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "$ref": "#/$defs/metric"
      }
    }
  },
  "$defs": {
    "pointer": {
      "type": "string",
      "pattern": "^(?:/(?:[^~/]|~0|~1)*)*$"
    },
    "metric": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "label",
        "scope"
      ],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "scope": {
          "enum": [
            "currentPage",
            "serverAggregate"
          ]
        },
        "aggregation": {
          "enum": [
            "count",
            "sum",
            "avg",
            "min",
            "max"
          ]
        },
        "fieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "operationRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "valuePointer": {
          "$ref": "#/$defs/pointer"
        }
      }
    },
    "dataSource": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "operationRef",
        "itemsPointer",
        "rowKeyPointer"
      ],
      "properties": {
        "operationRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "itemsPointer": {
          "$ref": "#/$defs/pointer"
        },
        "totalPointer": {
          "$ref": "#/$defs/pointer"
        },
        "rowKeyPointer": {
          "$ref": "#/$defs/pointer"
        }
      }
    },
    "field": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "label",
        "valuePointer",
        "type"
      ],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        },
        "label": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "valuePointer": {
          "$ref": "#/$defs/pointer"
        },
        "type": {
          "enum": [
            "string",
            "number",
            "date",
            "datetime",
            "enum",
            "boolean",
            "money"
          ]
        },
        "format": {
          "type": "string",
          "maxLength": 64
        },
        "enumValues": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "string",
            "maxLength": 120
          }
        }
      }
    },
    "filter": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "fieldKey",
        "queryParam",
        "operator",
        "inputType"
      ],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        },
        "fieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "queryParam": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "operator": {
          "enum": [
            "eq",
            "contains",
            "gt",
            "gte",
            "lt",
            "lte",
            "in"
          ]
        },
        "inputType": {
          "enum": [
            "string",
            "number",
            "date",
            "boolean",
            "enum"
          ]
        }
      }
    },
    "constraint": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "min": {
          "type": "number"
        },
        "max": {
          "type": "number"
        },
        "minLength": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        },
        "maxLength": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        },
        "pattern": {
          "type": "string",
          "maxLength": 256,
          "pattern": "^\\^\\[(?:0-9|A-Za-z|A-Za-z0-9|A-Za-z0-9_-)\\]\\{[0-9]+(?:,[0-9]+)?\\}\\$"
        },
        "nullable": {
          "type": "boolean"
        },
        "readonly": {
          "type": "boolean"
        }
      }
    },
    "bodyField": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "type"
      ],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
        },
        "type": {
          "enum": [
            "string",
            "number",
            "integer",
            "boolean",
            "date",
            "enum"
          ]
        },
        "required": {
          "type": "boolean"
        },
        "label": {
          "type": "string",
          "maxLength": 120
        },
        "constraints": {
          "$ref": "#/$defs/constraint"
        },
        "enumValues": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "string",
            "maxLength": 120
          }
        }
      }
    },
    "parameterMappingEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "param",
        "fieldKey"
      ],
      "properties": {
        "param": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "fieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    },
    "bodyParameterMappingEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "param",
        "bodyFieldKey"
      ],
      "properties": {
        "param": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "bodyFieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      }
    },
    "parameterMapping": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "path": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/$defs/parameterMappingEntry"
          }
        },
        "body": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/$defs/bodyParameterMappingEntry"
          }
        }
      }
    },
    "batch": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "dataSourceRef",
        "idsFieldKey",
        "target"
      ],
      "properties": {
        "type": {
          "const": "ids"
        },
        "dataSourceRef": {
          "const": "primary"
        },
        "idsFieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "target": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "in",
            "param"
          ],
          "properties": {
            "in": {
              "const": "body"
            },
            "param": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            }
          }
        }
      }
    },
    "operation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "apiDocumentId",
        "operation_id",
        "method",
        "path",
        "role"
      ],
      "properties": {
        "key": {
          "type": "string",
          "pattern": "^[A-Za-z][A-Za-z0-9_.-]{0,119}$"
        },
        "apiDocumentId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "operation_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "method": {
          "enum": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE"
          ]
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2048
        },
        "role": {
          "enum": [
            "list",
            "detail",
            "create",
            "update",
            "delete",
            "stat",
            "export",
            "stats",
            "read",
            "batch"
          ]
        },
        "bodySchema": {
          "type": "array",
          "maxItems": 50,
          "items": {
            "$ref": "#/$defs/bodyField"
          }
        },
        "parameterMapping": {
          "$ref": "#/$defs/parameterMapping"
        },
        "batch": {
          "$ref": "#/$defs/batch"
        },
        "confirmMessage": {
          "type": "string",
          "maxLength": 500
        },
        "sortParam": {
          "type": "string",
          "maxLength": 120
        },
        "pagination": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "pageParam",
            "sizeParam",
            "defaultSize"
          ],
          "properties": {
            "pageParam": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            "sizeParam": {
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            },
            "defaultSize": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          }
        }
      }
    },
    "sort": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "fieldKey",
        "order"
      ],
      "properties": {
        "fieldKey": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "order": {
          "enum": [
            "asc",
            "desc"
          ]
        }
      }
    },
    "view": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "type",
            "dataSourceRef",
            "fieldKeys"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "type": {
              "const": "list"
            },
            "title": {
              "type": "string",
              "maxLength": 120
            },
            "dataSourceRef": {
              "const": "primary"
            },
            "fieldKeys": {
              "type": "array",
              "maxItems": 50,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64
              }
            },
            "defaultSort": {
              "$ref": "#/$defs/sort"
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "type",
            "dataSourceRef",
            "title",
            "chartType",
            "xFieldKey",
            "yFieldKey"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "type": {
              "const": "chart"
            },
            "dataSourceRef": {
              "const": "primary"
            },
            "title": {
              "type": "string",
              "maxLength": 120
            },
            "chartType": {
              "enum": [
                "bar",
                "line",
                "pie"
              ]
            },
            "xFieldKey": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "yFieldKey": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "groupByFieldKey": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "type",
            "dataSourceRef",
            "title",
            "groupFieldKey",
            "cardFieldKeys"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "type": {
              "const": "kanban"
            },
            "dataSourceRef": {
              "const": "primary"
            },
            "title": {
              "type": "string",
              "maxLength": 120
            },
            "groupFieldKey": {
              "type": "string",
              "minLength": 1,
              "maxLength": 64
            },
            "cardFieldKeys": {
              "type": "array",
              "maxItems": 20,
              "uniqueItems": true,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "type",
            "items"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "type": {
              "const": "tabs"
            },
            "items": {
              "type": "array",
              "minItems": 1,
              "maxItems": 10,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "key",
                  "label",
                  "view"
                ],
                "properties": {
                  "key": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64
                  },
                  "label": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 120
                  },
                  "view": {
                    "$ref": "#/$defs/view"
                  }
                }
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "key",
            "type",
            "left",
            "right"
          ],
          "properties": {
            "key": {
              "type": "string",
              "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,63}$"
            },
            "type": {
              "const": "split"
            },
            "left": {
              "$ref": "#/$defs/view"
            },
            "right": {
              "$ref": "#/$defs/view"
            },
            "splitRatio": {
              "type": "number",
              "minimum": 0.2,
              "maximum": 0.8
            }
          }
        }
      ]
    },
    "color": {
      "type": "string",
      "pattern": "^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$"
    },
    "styleTokens": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "primary": {
          "$ref": "#/$defs/color"
        },
        "primaryBg": {
          "$ref": "#/$defs/color"
        },
        "primaryBgHover": {
          "$ref": "#/$defs/color"
        },
        "surface": {
          "$ref": "#/$defs/color"
        },
        "surfaceAlt": {
          "$ref": "#/$defs/color"
        },
        "surfaceControl": {
          "$ref": "#/$defs/color"
        },
        "border": {
          "$ref": "#/$defs/color"
        },
        "borderControl": {
          "$ref": "#/$defs/color"
        },
        "focusRing": {
          "$ref": "#/$defs/color"
        },
        "text": {
          "$ref": "#/$defs/color"
        },
        "textMuted": {
          "$ref": "#/$defs/color"
        },
        "textSubtle": {
          "$ref": "#/$defs/color"
        },
        "danger": {
          "$ref": "#/$defs/color"
        },
        "dangerBg": {
          "$ref": "#/$defs/color"
        },
        "success": {
          "$ref": "#/$defs/color"
        },
        "radius": {
          "enum": [
            "none",
            "sm",
            "md",
            "lg",
            "full"
          ]
        },
        "density": {
          "enum": [
            "compact",
            "comfortable",
            "relaxed"
          ]
        }
      }
    }
  }
} as const;
