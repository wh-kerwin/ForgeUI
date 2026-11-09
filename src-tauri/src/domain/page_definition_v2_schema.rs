use serde_json::Value;

const SCHEMA_JSON: &str = include_str!("../../../contracts/page-definition-v2.schema.json");

pub fn validate_v2(value: &Value) -> Result<(), String> {
    let schema: Value = serde_json::from_str(SCHEMA_JSON)
        .map_err(|_| "内置 PageDefinition v2 schema 无效".to_string())?;
    let validator = jsonschema::validator_for(&schema)
        .map_err(|_| "内置 PageDefinition v2 schema 无法编译".to_string())?;
    validator.validate(value).map_err(|error| {
        format!(
            "PageDefinition v2 schema validation failed at {}",
            error.instance_path
        )
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn shared_schema_fixtures_match_rust_and_domain_validation() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let directory = root.join("contracts/fixtures/v2");
        let manifest: Value =
            serde_json::from_slice(&fs::read(directory.join("manifest.json")).unwrap()).unwrap();
        for case in manifest["cases"].as_array().unwrap() {
            let name = case["file"].as_str().unwrap();
            let value: Value =
                serde_json::from_slice(&fs::read(directory.join(name)).unwrap()).unwrap();
            let schema_result = validate_v2(&value);
            let accepted = case["accepted"].as_bool().unwrap();
            assert_eq!(
                schema_result.is_ok(),
                accepted
                    || case["schemaAccepted"] == true
                    || [
                        "duplicate-field-key",
                        "duplicate-operation-key",
                        "bad-operation-reference",
                        "duplicate-view-key",
                        "deep-view-rejected",
                    ]
                    .iter()
                    .any(|id| case["id"] == *id),
                "schema fixture {name}: {schema_result:?}"
            );
            let result = super::super::page_definition_v2::validate_raw(value);
            assert_eq!(
                result.is_ok(),
                accepted,
                "domain fixture {name}: {result:?}"
            );
            if let Err(issues) = &result {
                if [
                    "duplicate-field-key",
                    "duplicate-operation-key",
                    "bad-operation-reference",
                    "duplicate-view-key",
                    "deep-view-rejected",
                ]
                .iter()
                .any(|id| case["id"] == *id)
                {
                    assert_eq!(issues[0].stage, "reference", "domain-stage {name}");
                }
            }
        }
    }
}
