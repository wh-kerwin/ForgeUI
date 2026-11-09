//! Opt-in versioned decoding; existing v1 callers remain unchanged.

use super::page_definition_v2_types::PageDefinitionV2;
use super::page_spec::{PageIssue, PageSpec};

/// Maximum raw UTF-8 input size at this opt-in boundary (2 MiB).
pub const MAX_PAGE_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug)]
pub enum PageDocument {
    V1(PageSpec),
    V2(PageDefinitionV2),
}

#[derive(Debug)]
pub struct DecodedPageDocument {
    pub page: PageDocument,
    pub issues: Vec<PageIssue>,
    pub repaired: bool,
}

/// Decode raw model JSON, allowing only the same outer-envelope removal as v1.
/// Missing version and numeric v1 delegate to the existing detailed decoder;
/// numeric v2 always passes shared schema/domain validation before serde DTOs.
/// Diagnostics never include parser errors or input values.
pub fn decode_page_document(content: &str) -> Result<DecodedPageDocument, Vec<PageIssue>> {
    if content.len() > MAX_PAGE_DOCUMENT_BYTES {
        return Err(vec![PageIssue::error(
            "PAGE_INPUT_LIMIT_EXCEEDED",
            "",
            "syntax",
            "页面 JSON 超过输入大小限制",
        )]);
    }
    let (value, repaired) = match serde_json::from_str::<serde_json::Value>(content.trim()) {
        Ok(value) => (value, false),
        Err(_) => (
            super::page_schema::decode_json(content).map_err(|_| {
                vec![PageIssue::error(
                    "PAGE_JSON_INVALID",
                    "",
                    "syntax",
                    "页面 JSON 无法解析，请重新生成或修复语法",
                )]
            })?,
            true,
        ),
    };
    match value.get("version") {
        None => decode_v1(content),
        Some(version) if version.as_f64() == Some(1.0) => decode_v1(content),
        Some(version) if version.as_f64() == Some(2.0) => {
            let page = super::page_definition_v2_types::decode_validated(value)?;
            let issues = if repaired {
                vec![PageIssue {
                    code: "PAGE_JSON_ENVELOPE_REMOVED".into(),
                    path: String::new(),
                    severity: "warning".into(),
                    stage: "syntax".into(),
                    message: "已移除 JSON 外层文本，页面字段未改写".into(),
                    suggested_fix: None,
                }]
            } else {
                vec![]
            };
            Ok(DecodedPageDocument {
                page: PageDocument::V2(page),
                issues,
                repaired,
            })
        }
        Some(_) => Err(vec![PageIssue::error(
            "PAGE_VERSION_UNSUPPORTED",
            "/version",
            "schema",
            "仅支持页面版本 v1 或 v2",
        )]),
    }
}

fn decode_v1(content: &str) -> Result<DecodedPageDocument, Vec<PageIssue>> {
    super::page_schema::decode_page_spec_detailed(content).map(|decoded| DecodedPageDocument {
        page: PageDocument::V1(decoded.page),
        issues: decoded.issues,
        repaired: decoded.repaired,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn v1() -> Value {
        json!({"title":"Orders","description":"","filters":[],"stats":[],"columns":[],"rows":[]})
    }

    fn v2() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/fixtures/v2/minimal-v2.json"
        ))
        .unwrap()
    }

    #[test]
    fn missing_version_and_one_preserve_v1_decode() {
        for version in [None, Some(json!(1)), Some(json!(1.0))] {
            let mut value = v1();
            if let Some(version) = version {
                value["version"] = version;
            }
            let raw = format!("```json\n{value}\n```");
            let old = super::super::page_schema::decode_page_spec_detailed(&raw).unwrap();
            let new = decode_page_document(&raw).unwrap();
            let PageDocument::V1(page) = new.page else {
                panic!("expected v1")
            };
            assert_eq!(
                serde_json::to_value(page).unwrap(),
                serde_json::to_value(old.page).unwrap()
            );
            assert_eq!(new.repaired, old.repaired);
            assert_eq!(
                serde_json::to_value(new.issues).unwrap(),
                serde_json::to_value(old.issues).unwrap()
            );
        }
    }

    #[test]
    fn two_decodes_to_typed_v2_and_roundtrips() {
        let value = v2();
        let decoded = decode_page_document(&value.to_string()).unwrap();
        let PageDocument::V2(page) = decoded.page else {
            panic!("expected v2")
        };
        assert_eq!(page.fields[0].key, "orderId");
        assert_eq!(serde_json::to_value(page).unwrap(), value);
        assert!(!decoded.repaired);
        assert!(decoded.issues.is_empty());
    }

    #[test]
    fn unsupported_null_string_and_fractional_versions_are_rejected() {
        for version in [
            json!(3),
            Value::Null,
            json!("2"),
            json!("1"),
            json!(true),
            json!(2.5),
            json!(-1),
        ] {
            let mut value = v1();
            value["version"] = version;
            let issues = decode_page_document(&value.to_string()).unwrap_err();
            assert_eq!(issues[0].code, "PAGE_VERSION_UNSUPPORTED");
            assert_eq!(issues[0].path, "/version");
        }
    }

    #[test]
    fn v2_extra_rows_are_rejected_before_serde_can_discard_them() {
        let mut value = v2();
        value["rows"] = json!([]);
        let issues = decode_page_document(&value.to_string()).unwrap_err();
        assert_eq!(issues[0].code, "PAGE_V2_SCHEMA_INVALID");
    }

    fn mapped() -> Value {
        let mut value = v2();
        value["operations"].as_array_mut().unwrap().push(json!({
            "key":"orders.update","apiDocumentId":"orders-doc","operation_id":"updateOrder",
            "method":"PATCH","path":"/orders/{id}","role":"update",
            "bodySchema":[{"key":"name","type":"string","required":true}],
            "parameterMapping":{"path":[{"param":"id","fieldKey":"orderId"}],"body":[{"param":"name","bodyFieldKey":"name"}]}
        }));
        value
    }

    #[test]
    fn legal_mapping_roundtrips_without_losing_typed_fields() {
        let value = mapped();
        let decoded = decode_page_document(&value.to_string()).unwrap();
        let PageDocument::V2(page) = decoded.page else {
            panic!("expected v2")
        };
        assert_eq!(
            page.operations[1]
                .parameter_mapping
                .as_ref()
                .unwrap()
                .path
                .as_ref()
                .unwrap()[0]
                .field_key,
            "orderId"
        );
        assert_eq!(serde_json::to_value(page).unwrap(), value);
    }

    #[test]
    fn mapping_domain_errors_are_returned_unchanged() {
        let mut value = mapped();
        value["operations"][1]["parameterMapping"]["path"][0]["fieldKey"] = json!("missing");
        let expected = super::super::page_definition_v2::validate_raw(value.clone()).unwrap_err();
        let actual = decode_page_document(&value.to_string()).unwrap_err();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }

    #[test]
    fn shared_fixture_acceptance_and_typed_roundtrips_match_validator() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/v2");
        let manifest: Value =
            serde_json::from_str(include_str!("../../../contracts/fixtures/v2/manifest.json"))
                .unwrap();
        for case in manifest["cases"].as_array().unwrap() {
            let raw = std::fs::read_to_string(dir.join(case["file"].as_str().unwrap())).unwrap();
            let value: Value = serde_json::from_str(&raw).unwrap();
            let decoded = decode_page_document(&raw);
            assert_eq!(
                decoded.is_ok(),
                case["accepted"].as_bool().unwrap(),
                "{}: {decoded:?}",
                case["id"]
            );
            let direct = serde_json::from_str::<PageDefinitionV2>(&raw);
            assert_eq!(direct.is_ok(), decoded.is_ok(), "{}", case["id"]);
            if let Ok(decoded) = decoded {
                let PageDocument::V2(page) = decoded.page else {
                    panic!("expected v2")
                };
                assert_eq!(
                    serde_json::to_value(&page).unwrap(),
                    value,
                    "{}",
                    case["id"]
                );
                assert_eq!(direct.unwrap(), page);
            }
        }
    }

    #[test]
    fn optional_metadata_style_and_recursive_views_roundtrip() {
        let mut value = mapped();
        value["layout"] = json!("modal");
        value["breadcrumb"] = json!(["Orders"]);
        value["permissionRole"] = json!("admin");
        value["theme"] = json!("custom");
        value["styleTokens"] = json!({
            "primary":"#abc","primaryBg":"#abcd","primaryBgHover":"#123456",
            "surface":"#12345678","surfaceAlt":"#abc","surfaceControl":"#abc",
            "border":"#abc","borderControl":"#abc","focusRing":"#abc","text":"#abc",
            "textMuted":"#abc","textSubtle":"#abc","danger":"#abc","dangerBg":"#abc",
            "success":"#abc","radius":"lg","density":"comfortable"
        });
        value["fields"][0]["format"] = json!("text");
        value["fields"]
            .as_array_mut()
            .unwrap()
            .push(json!({"key":"amount","label":"Amount","valuePointer":"/amount","type":"money"}));
        value["operations"][0]["sortParam"] = json!("sort");
        value["operations"][0]["pagination"] =
            json!({"pageParam":"page","sizeParam":"size","defaultSize":20});
        value["operations"][1]["confirmMessage"] = json!("Confirm?");
        value["operations"][1]["bodySchema"][0]["label"] = json!("Name");
        value["operations"][1]["bodySchema"][0]["constraints"] = json!({"minLength":1,"maxLength":8,"pattern":"^[A-Za-z]{1,8}$","nullable":false,"readonly":false});
        value["views"] = json!([{
            "key":"tabs","type":"tabs","items":[{"key":"tab","label":"Tab","view":{
                "key":"split","type":"split","splitRatio":0.4,
                "left":{"key":"chart","type":"chart","title":"Chart","dataSourceRef":"primary","chartType":"bar","xFieldKey":"orderId","yFieldKey":"amount","groupByFieldKey":"orderId"},
                "right":{"key":"kanban","type":"kanban","title":"Board","dataSourceRef":"primary","groupFieldKey":"orderId","cardFieldKeys":["amount"]}
            }}]
        },{"key":"list","type":"list","title":"List","dataSourceRef":"primary","fieldKeys":["orderId"],"defaultSort":{"fieldKey":"orderId","order":"desc"}}]);
        let decoded = decode_page_document(&value.to_string()).unwrap();
        let PageDocument::V2(page) = decoded.page else {
            panic!("expected v2")
        };
        assert_eq!(serde_json::to_value(page).unwrap(), value);
    }

    #[test]
    fn numeric_v2_and_integral_decimal_schema_integers_are_accepted() {
        let mut value = mapped();
        value["version"] = json!(2.0);
        value["operations"][0]["pagination"] =
            json!({"pageParam":"page","sizeParam":"size","defaultSize":20.0});
        value["operations"][1]["bodySchema"][0]["constraints"] =
            json!({"minLength":1.0,"maxLength":10.0});
        let decoded = decode_page_document(&value.to_string()).unwrap();
        let PageDocument::V2(page) = decoded.page else {
            panic!("expected v2")
        };
        assert_eq!(
            page.operations[0].pagination.as_ref().unwrap().default_size,
            20
        );
        assert_eq!(
            page.operations[1].body_schema.as_ref().unwrap()[0]
                .constraints
                .as_ref()
                .unwrap()
                .max_length,
            Some(10)
        );
    }

    #[test]
    fn integral_enum_length_constraints_reject_before_typed_normalization() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/v2");
        let mut failures = Vec::new();
        for name in [
            "enum-min-length-decimal.json",
            "enum-min-length-exponent.json",
            "enum-max-length-decimal.json",
            "enum-max-length-exponent.json",
        ] {
            let raw = std::fs::read_to_string(dir.join(name)).unwrap();
            let value: Value = serde_json::from_str(&raw).unwrap();
            assert!(super::super::page_definition_v2_schema::validate_v2(&value).is_ok());
            let expected = |issues: &[PageIssue]| {
                issues.iter().any(|issue| {
                    issue.code == "PAGE_V2_ENUM_CONSTRAINT_INVALID"
                        && issue.path == "/operations/0/bodySchema/0/enumValues"
                })
            };
            let validated = super::super::page_definition_v2::validate_raw(value);
            let decoded = decode_page_document(&raw);
            if !validated.as_ref().is_err_and(|issues| expected(issues))
                || !decoded.as_ref().is_err_and(|issues| expected(issues))
                || serde_json::from_str::<PageDefinitionV2>(&raw).is_ok()
            {
                failures.push(name);
            }
        }
        assert!(
            failures.is_empty(),
            "accepted invalid enum constraints: {failures:?}"
        );
    }

    #[test]
    fn integral_enum_length_boundaries_survive_typed_roundtrip() {
        for token in ["2.0", "2e0"] {
            let mut value = mapped();
            value["operations"][1]["bodySchema"][0] = json!({
                "key":"value", "type":"enum", "enumValues":["AB", "😀A"],
                "constraints":{"minLength":2,"maxLength":2}
            });
            value["operations"][1]["parameterMapping"]["body"][0]["bodyFieldKey"] = json!("value");
            let raw = value
                .to_string()
                .replace("\"minLength\":2", &format!("\"minLength\":{token}"))
                .replace("\"maxLength\":2", &format!("\"maxLength\":{token}"));
            let decoded = decode_page_document(&raw).unwrap();
            let PageDocument::V2(page) = decoded.page else {
                panic!("expected v2")
            };
            assert!(!decoded.repaired);
            assert!(decoded.issues.is_empty());
            assert_eq!(
                serde_json::from_str::<PageDefinitionV2>(&raw).unwrap(),
                page
            );
            let serialized = serde_json::to_string(&page).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&serialized).unwrap(), value);
            let PageDocument::V2(roundtripped) = decode_page_document(&serialized).unwrap().page
            else {
                panic!("expected v2")
            };
            assert_eq!(roundtripped, page);
        }
    }

    #[test]
    fn direct_dto_deserialization_cannot_bypass_shared_validation() {
        for (path, replacement) in [
            ("/title", json!("")),
            ("/layout", Value::Null),
            ("/fields/0/type", json!("unknown")),
            ("/dataSources/primary/operationRef", json!("missing")),
        ] {
            let mut value = v2();
            value["layout"] = json!("sidebar");
            *value
                .pointer_mut(path)
                .unwrap_or_else(|| panic!("missing path {path}")) = replacement;
            assert!(serde_json::from_value::<PageDefinitionV2>(value).is_err());
        }
    }

    #[test]
    fn malformed_oversized_and_deep_json_have_safe_errors() {
        for raw in [
            "{\"secret-marker\":".to_string(),
            " ".repeat(MAX_PAGE_DOCUMENT_BYTES + 1),
            format!("{}\"secret-marker\"{}", "[".repeat(200), "]".repeat(200)),
        ] {
            let issues = decode_page_document(&raw).unwrap_err();
            let output = serde_json::to_string(&issues).unwrap();
            assert!(!output.contains("secret-marker"));
            assert_eq!(issues.len(), 1);
            assert_eq!(issues[0].stage, "syntax");
        }
    }
}
