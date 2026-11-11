use crate::{
    domain::{
        artifact_projection,
        page_spec::{validate, PageSpec},
    },
    repositories::database,
};
use rusqlite::{params, Connection, Transaction};

/// Project, then validate, every definition before it reaches any persistence boundary.
pub fn safe_artifact_payload(payload: &str) -> Result<String, String> {
    let projected = artifact_projection::project_payload(payload)?;
    if artifact_projection::has_payload_data(&projected)? {
        return Err("页面定义仍包含数据字段".into());
    }
    let mut value: serde_json::Value =
        serde_json::from_str(&projected).map_err(|e| format!("页面 DSL 无效：{e}"))?;
    // v1 DTO requires these structural arrays even when their data was dropped.
    if let serde_json::Value::Object(map) = &mut value {
        map.insert("stats".into(), serde_json::Value::Array(vec![]));
        map.insert("rows".into(), serde_json::Value::Array(vec![]));
        for key in ["filters", "columns"] {
            map.entry(key)
                .or_insert_with(|| serde_json::Value::Array(vec![]));
        }
        for key in ["title", "description"] {
            map.entry(key)
                .or_insert_with(|| serde_json::Value::String(String::new()));
        }
        // A dropped custom batch payload must not leave an invalid "custom" action.
        if let Some(serde_json::Value::Array(actions)) = map.get_mut("batchActions") {
            for action in actions {
                if let Some(builder) = action.get_mut("payloadBuilder") {
                    let custom =
                        builder.get("type").and_then(|value| value.as_str()) == Some("custom");
                    if custom && builder.get("customPayload").is_none() {
                        if let Some(fields) = builder.as_object_mut() {
                            fields.insert("type".into(), serde_json::Value::String("ids".into()));
                        }
                    }
                }
            }
        }
    }
    let spec: PageSpec =
        serde_json::from_value(value).map_err(|e| format!("页面 DSL 无效：{e}"))?;
    validate(&spec)?;
    // Persist the validated DTO, not the caller's string.
    serde_json::to_string(&spec).map_err(|_| "页面定义序列化失败".to_string())
}

/// Legacy rows can predate the projection, so reads re-validate the payload too.
fn sanitize_loaded_row(row: &str) -> String {
    const MINIMUM: &str = r#"{"version":1,"title":"","description":"","filters":[],"stats":[],"columns":[],"rows":[]}"#;
    let mut value: serde_json::Value = match serde_json::from_str(row) {
        Ok(value) => value,
        Err(_) => return row.to_string(),
    };
    let payload = value
        .get("payload")
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .to_string();
    let clean = safe_artifact_payload(&payload).unwrap_or_else(|_| MINIMUM.to_string());
    if let Some(slot) = value.get_mut("payload") {
        *slot = serde_json::Value::String(clean);
    }
    serde_json::to_string(&value).unwrap_or_else(|_| row.to_string())
}

fn validate_artifact_scope(
    transaction: &Transaction<'_>,
    project_id: &str,
    api_document_ids: &[String],
) -> Result<Vec<String>, String> {
    let project_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !project_exists {
        return Err("项目不存在".into());
    }
    let mut unique = Vec::new();
    for id in api_document_ids {
        if unique.iter().any(|existing| existing == id) {
            continue;
        }
        let belongs_to_project: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM api_documents WHERE id=?1 AND project_id=?2)",
                params![id, project_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !belongs_to_project {
            return Err("页面引用了不属于当前项目的 API 文档".into());
        }
        unique.push(id.clone());
    }
    Ok(unique)
}

pub fn save_model_metadata(id: String, payload: String) -> Result<(), String> {
    let payload = sanitize_model_metadata(&payload)?;
    let db = database::open()?;
    db.execute("INSERT INTO model_configs (id,payload,updated_at) VALUES (?1,?2,datetime('now')) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at", params![id, payload]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn sanitize_model_metadata(payload: &str) -> Result<String, String> {
    let mut metadata: serde_json::Value =
        serde_json::from_str(payload).map_err(|e| format!("模型配置元数据无效：{e}"))?;
    if let Some(headers) = metadata
        .get_mut("customHeaders")
        .and_then(|value| value.as_object_mut())
    {
        for value in headers.values_mut() {
            *value = serde_json::Value::String(String::new());
        }
    }
    metadata.as_object_mut().map(|object| {
        object.remove("apiKey");
    });
    serde_json::to_string(&metadata).map_err(|e| e.to_string())
}

pub fn load_model_metadata() -> Result<Vec<String>, String> {
    let db = database::open()?;
    let mut statement = db
        .prepare("SELECT payload FROM model_configs ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_model_config(id: String) -> Result<(), String> {
    let db = database::open()?;
    let default_model: Option<String> = db
        .query_row(
            "SELECT value FROM app_settings WHERE key='default_model_id'",
            [],
            |row| row.get(0),
        )
        .ok();
    if default_model.as_deref() == Some(&id) {
        return Err("请先设置另一个默认模型，再删除此配置".into());
    }
    let template_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM templates WHERE model_id=?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if template_count > 0 {
        return Err(format!(
            "该模型仍被 {template_count} 个模板引用；请先改用其他模型或删除对应模板"
        ));
    }
    let session_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM generation_sessions WHERE model_id=?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if session_count > 0 {
        return Err(format!(
            "该模型仍被 {session_count} 条生成会话引用；请先保留历史或清理会话"
        ));
    }
    let affected = db
        .execute("DELETE FROM model_configs WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("模型配置不存在".into());
    }
    Ok(())
}

pub fn set_default_model(id: String) -> Result<(), String> {
    let db = database::open()?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM model_configs WHERE id=?1)",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("模型配置不存在，无法设为默认".into());
    }
    db.execute("INSERT INTO app_settings(key,value,updated_at) VALUES('default_model_id',?1,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_default_model() -> Result<Option<String>, String> {
    let db = database::open()?;
    match db.query_row(
        "SELECT value FROM app_settings WHERE key='default_model_id'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn save_generation_session(
    id: String,
    project_id: String,
    model_id: String,
    prompt: String,
    payload: String,
    api_document_ids: Vec<String>,
) -> Result<(), String> {
    artifact_projection::validate_session_prompt(&prompt)?;
    let payload = safe_artifact_payload(&payload)?;
    let mut db = database::open()?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    let api_document_ids = validate_artifact_scope(&transaction, &project_id, &api_document_ids)?;
    transaction.execute("INSERT INTO generation_sessions(id,project_id,model_id,prompt,payload,created_at) VALUES(?1,?2,?3,?4,?5,datetime('now'))", params![id, project_id, model_id, prompt, payload]).map_err(|e| e.to_string())?;
    for api_document_id in api_document_ids {
        transaction
            .execute(
                "INSERT INTO generation_session_api_documents(session_id,api_document_id) VALUES(?1,?2)",
                params![id, api_document_id],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}

pub fn load_generation_sessions(project_id: String) -> Result<Vec<String>, String> {
    let db = database::open()?;
    let mut statement = db.prepare("SELECT json_object('id',id,'projectId',project_id,'modelId',model_id,'prompt',prompt,'payload',payload,'createdAt',created_at,'apiDocumentIds',json(COALESCE((SELECT json_group_array(api_document_id) FROM generation_session_api_documents refs WHERE refs.session_id=generation_sessions.id),'[]'))) FROM generation_sessions WHERE project_id=?1 ORDER BY created_at DESC LIMIT 100").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![project_id], |row| {
            let raw: String = row.get(0)?;
            Ok(sanitize_loaded_row(&raw))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_generation_session(id: String) -> Result<(), String> {
    let db = database::open()?;
    let affected = db
        .execute("DELETE FROM generation_sessions WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("生成历史不存在或已删除".into());
    }
    Ok(())
}

pub fn save_business_connection(payload: String) -> Result<(), String> {
    let db = database::open()?;
    db.execute("INSERT INTO business_connection(id,payload,updated_at) VALUES(1,?1,datetime('now')) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at", params![payload]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_business_connection() -> Result<Option<String>, String> {
    let db = database::open()?;
    match db.query_row(
        "SELECT payload FROM business_connection WHERE id=1",
        [],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn save_template(
    id: String,
    project_id: String,
    name: String,
    payload: String,
    model_id: Option<String>,
    api_document_ids: Vec<String>,
) -> Result<(), String> {
    let payload = safe_artifact_payload(&payload)?;
    let mut db = database::open()?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    save_template_in(
        &transaction,
        &id,
        &project_id,
        &name,
        &payload,
        model_id.as_deref(),
        api_document_ids,
    )?;
    transaction.commit().map_err(|e| e.to_string())
}

fn save_template_in(
    transaction: &Transaction<'_>,
    id: &str,
    project_id: &str,
    name: &str,
    payload: &str,
    model_id: Option<&str>,
    api_document_ids: Vec<String>,
) -> Result<(), String> {
    let api_document_ids = validate_artifact_scope(transaction, project_id, &api_document_ids)?;
    transaction.execute("INSERT INTO templates (id,project_id,name,payload,model_id,version,updated_at) VALUES (?1,?2,?3,?4,?5,1,datetime('now')) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,payload=excluded.payload,model_id=excluded.model_id,version=templates.version+1,updated_at=excluded.updated_at", params![id, project_id, name, payload, model_id]).map_err(|e| e.to_string())?;
    let version: i64 = transaction
        .query_row(
            "SELECT version FROM templates WHERE id=?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    transaction.execute("INSERT OR REPLACE INTO template_versions(template_id,version,payload,created_at) VALUES(?1,?2,?3,datetime('now'))", params![id, version, payload]).map_err(|e| e.to_string())?;
    transaction
        .execute(
            "DELETE FROM template_api_documents WHERE template_id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    for api_document_id in api_document_ids {
        transaction
            .execute(
                "INSERT INTO template_api_documents(template_id,api_document_id) VALUES(?1,?2)",
                params![id, api_document_id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn rename_template(id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("模板名称不能为空且不能超过 120 个字符".into());
    }
    let db = database::open()?;
    let affected = db
        .execute(
            "UPDATE templates SET name=?2,updated_at=datetime('now') WHERE id=?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("模板不存在".into());
    }
    Ok(())
}

pub fn load_templates(project_id: String) -> Result<Vec<String>, String> {
    let db = database::open()?;
    load_templates_in(&db, &project_id)
}

fn load_templates_in(db: &Connection, project_id: &str) -> Result<Vec<String>, String> {
    let mut statement = db.prepare("SELECT json_object('id',id,'projectId',project_id,'name',name,'payload',payload,'modelId',model_id,'version',version,'updatedAt',updated_at,'apiDocumentIds',json(COALESCE((SELECT json_group_array(api_document_id) FROM template_api_documents refs WHERE refs.template_id=templates.id),'[]'))) FROM templates WHERE project_id=?1 ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![project_id], |row| {
            let raw: String = row.get(0)?;
            Ok(sanitize_loaded_row(&raw))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_template(id: String) -> Result<(), String> {
    let mut db = database::open()?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    let affected = transaction
        .execute("DELETE FROM templates WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("模板不存在".into());
    }
    transaction
        .execute(
            "DELETE FROM template_versions WHERE template_id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn load_template_versions(id: String) -> Result<Vec<String>, String> {
    let db = database::open()?;
    let mut statement = db.prepare("SELECT json_object('version',version,'payload',payload,'createdAt',created_at) FROM template_versions WHERE template_id=?1 ORDER BY version DESC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![id], |row| {
            let raw: String = row.get(0)?;
            Ok(sanitize_loaded_row(&raw))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn restore_template_version(id: String, version: i64) -> Result<(), String> {
    let db = database::open()?;
    restore_template_version_in(&db, &id, version)
}

/// A historical payload can predate the projection; restoring it must not revive data.
fn restore_template_version_in(db: &Connection, id: &str, version: i64) -> Result<(), String> {
    let payload: String = db
        .query_row(
            "SELECT payload FROM template_versions WHERE template_id=?1 AND version=?2",
            params![id, version],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let payload = safe_artifact_payload(&payload)?;
    db.execute(
        "UPDATE templates SET payload=?2,version=version+1,updated_at=datetime('now') WHERE id=?1",
        params![id, payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn export_template(id: String) -> Result<String, String> {
    let db = database::open()?;
    export_template_in(&db, &id)
}

fn export_template_in(db: &Connection, id: &str) -> Result<String, String> {
    let (name, payload, version): (String, String, i64) = db
        .query_row(
            "SELECT name,payload,version FROM templates WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("模板不存在：{error}"))?;
    let raw: serde_json::Value =
        serde_json::from_str(&payload).map_err(|_| "模板页面内容无效".to_string())?;
    let is_v2 = raw.get("version").and_then(|value| value.as_f64()) == Some(2.0);
    // The v1 projection would destroy v2 structure; with the write gate closed no
    // legitimate v2 template can exist, so refuse instead of silently corrupting it.
    if is_v2 {
        return Err("v2 模板导出尚未启用：默认写入门禁未打开".into());
    }
    let payload = safe_artifact_payload(&payload)?;
    Ok(serde_json::json!({
        "format": "forge-template-v1",
        "id": id,
        "name": name,
        "payload": payload,
        "version": version
    })
    .to_string())
}

pub fn import_template(document: String, project_id: String) -> Result<(), String> {
    let mut db = database::open()?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    import_template_in(&transaction, &document, &project_id)?;
    transaction.commit().map_err(|e| e.to_string())
}

fn import_template_in(
    transaction: &Transaction<'_>,
    document: &str,
    project_id: &str,
) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(document).map_err(|_| "模板 JSON 无效".to_string())?;
    match value.get("format").and_then(|item| item.as_str()) {
        Some("forge-template-v1") => {}
        // v2 writes stay behind the explicit gate until every entry point accepts v2.
        Some("forge-template-v2") => {
            if artifact_projection::DEFAULT_WRITE_VERSION < 2 {
                return Err("v2 模板写入尚未启用：请先预览迁移并确认重绑定".into());
            }
            return Err("v2 模板导入需要显式重绑定确认".into());
        }
        _ => return Err("不支持的模板格式".into()),
    }
    let id = value
        .get("id")
        .and_then(|item| item.as_str())
        .ok_or("模板缺少 id")?;
    let name = value
        .get("name")
        .and_then(|item| item.as_str())
        .unwrap_or("导入模板");
    let payload = value
        .get("payload")
        .and_then(|item| item.as_str())
        .ok_or("模板缺少页面内容")?;
    let payload = safe_artifact_payload(payload)?;
    // Document IDs, secret refs and base URLs were projected away; the host rebinds.
    save_template_in(
        transaction,
        &format!("imported-{id}"),
        project_id,
        name,
        &payload,
        None,
        Vec::new(),
    )
}

#[cfg(test)]
mod tests {
    use super::sanitize_model_metadata;

    #[test]
    fn metadata_sanitization_removes_all_secret_values() {
        let sanitized = sanitize_model_metadata(
            r#"{"id":"m1","apiKey":"model-secret","customHeaders":{"X-Trace":"header-secret","X-Team":"team-secret"},"customHeaderSecretRefs":{"X-Trace":"forge-header"}}"#,
        )
        .expect("valid model metadata");
        let value: serde_json::Value = serde_json::from_str(&sanitized).unwrap();
        assert!(value.get("apiKey").is_none());
        assert_eq!(value["customHeaders"]["X-Trace"], "");
        assert_eq!(value["customHeaders"]["X-Team"], "");
        assert_eq!(value["customHeaderSecretRefs"]["X-Trace"], "forge-header");
    }
}

#[cfg(test)]
mod artifact_tests {
    use super::*;
    use crate::repositories::migrations;
    use rusqlite::Connection;
    use serde_json::json;

    const MARKERS: &[&str] = &[
        "marker-row",
        "marker-stat",
        "marker-payload",
        "marker-header",
        "marker-secret",
        "other-project-doc",
    ];

    fn polluted_payload() -> String {
        json!({
            "version": 1, "title": "Orders", "description": "",
            "filters": [], "columns": ["id"],
            "rows": [["marker-row"]],
            "stats": [{"label": "count", "value": "marker-stat"}],
            "batchActions": [{"operation_id":"batchDelete","method":"DELETE","path":"/orders",
                "payloadBuilder":{"type":"custom","customPayload":"marker-payload"}}],
            "headers": {"X-Trace": "marker-header"},
            "secretRef": "marker-secret", "apiDocumentId": "other-project-doc",
            "operations": [{"operation_id":"listOrders","method":"GET","path":"/orders","role":"list"}]
        })
        .to_string()
    }

    /// An in-memory database, never the developer's real data directory.
    fn memory_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        migrations::apply(&db).unwrap();
        migrations::apply(&db).unwrap(); // idempotent on an existing database
        db.execute(
            "INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','Project','now','now')",
            [],
        )
        .unwrap();
        db
    }

    fn assert_clean(text: &str) {
        for marker in MARKERS {
            assert!(!text.contains(marker), "leaked {marker}");
        }
    }

    #[test]
    fn projection_purges_every_injected_marker_before_validation() {
        let clean = safe_artifact_payload(&polluted_payload()).unwrap();
        assert_clean(&clean);
        let value: serde_json::Value = serde_json::from_str(&clean).unwrap();
        assert_eq!(value["title"], "Orders");
        assert_eq!(value["rows"], json!([]));
        assert_eq!(value["stats"], json!([]));
    }

    #[test]
    fn save_export_import_roundtrip_never_persists_or_reimports_data() {
        let mut db = memory_db();
        let clean = safe_artifact_payload(&polluted_payload()).unwrap();
        {
            let transaction = db.transaction().unwrap();
            save_template_in(&transaction, "t1", "p1", "Orders", &clean, None, Vec::new()).unwrap();
            transaction.commit().unwrap();
        }
        let stored: String = db
            .query_row("SELECT payload FROM templates WHERE id='t1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_clean(&stored);
        let document = export_template_in(&db, "t1").unwrap();
        assert_clean(&document);
        let envelope: serde_json::Value = serde_json::from_str(&document).unwrap();
        assert_eq!(envelope["format"], "forge-template-v1");
        {
            let transaction = db.transaction().unwrap();
            import_template_in(&transaction, &document, "p1").unwrap();
            transaction.commit().unwrap();
        }
        let imported: String = db
            .query_row(
                "SELECT payload FROM templates WHERE id='imported-t1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_clean(&imported);
    }

    #[test]
    fn restoring_a_legacy_version_cannot_revive_its_data() {
        let db = memory_db();
        let clean = safe_artifact_payload(&polluted_payload()).unwrap();
        db.execute(
            "INSERT INTO templates(id,project_id,name,payload,version,updated_at) VALUES('t1','p1','Orders',?1,1,'now')",
            params![clean],
        )
        .unwrap();
        db.execute(
            "INSERT INTO template_versions(template_id,version,payload,created_at) VALUES('t1',1,?1,'now')",
            params![polluted_payload()],
        )
        .unwrap();
        restore_template_version_in(&db, "t1", 1).unwrap();
        let restored: String = db
            .query_row("SELECT payload FROM templates WHERE id='t1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_clean(&restored);
    }

    #[test]
    fn a_failed_scope_check_rolls_back_the_whole_transaction() {
        let mut db = memory_db();
        let clean = safe_artifact_payload(&polluted_payload()).unwrap();
        {
            let transaction = db.transaction().unwrap();
            save_template_in(&transaction, "t1", "p1", "Orders", &clean, None, Vec::new()).unwrap();
            assert!(save_template_in(
                &transaction,
                "t2",
                "p1",
                "Bad",
                &clean,
                None,
                vec!["missing-doc".into()],
            )
            .is_err());
            transaction.rollback().unwrap();
        }
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM templates", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn structural_constraints_survive_persistence_but_oversized_patterns_are_rejected() {
        let payload = json!({
            "version": 1, "title": "Orders", "description": "",
            "filters": [], "stats": [], "columns": ["id"], "rows": [],
            "operations": [{
                "operation_id": "updateOrder", "method": "PATCH", "path": "/orders/{id}", "role": "update",
                "bodySchema": [{"name": "amount", "type": "number", "required": true,
                    "constraints": {"min": 1, "max": 10, "minLength": 2, "maxLength": 8,
                        "pattern": "[0-9]+", "readonly": false}}]
            }]
        })
        .to_string();
        let clean = safe_artifact_payload(&payload).unwrap();
        let value: serde_json::Value = serde_json::from_str(&clean).unwrap();
        let constraints = &value["operations"][0]["bodySchema"][0]["constraints"];
        assert_eq!(constraints["min"].as_f64(), Some(1.0));
        assert_eq!(constraints["pattern"].as_str(), Some("[0-9]+"));
        assert_eq!(constraints["readonly"].as_bool(), Some(false));
        let oversized = payload.replace("[0-9]+", &"x".repeat(201));
        assert!(safe_artifact_payload(&oversized).is_err());
    }

    #[test]
    fn loading_legacy_templates_never_returns_their_data() {
        let db = memory_db();
        db.execute(
            "INSERT INTO templates(id,project_id,name,payload,version,updated_at) VALUES('legacy','p1','Legacy',?1,1,'now')",
            params![polluted_payload()],
        )
        .unwrap();
        let rows = load_templates_in(&db, "p1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_clean(&rows[0]);
        let record: serde_json::Value = serde_json::from_str(&rows[0]).unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(record["payload"].as_str().unwrap()).unwrap();
        assert_eq!(payload["rows"], json!([]));
        assert_eq!(payload["stats"], json!([]));
    }

    #[test]
    fn a_v2_history_payload_is_refused_instead_of_being_corrupted() {
        let db = memory_db();
        let historical = json!({
            "version": 2, "title": "V2",
            "dataSources": {"primary": {"operationRef": "orders.list"}},
            "fields": [], "filters": [], "operations": [], "views": []
        })
        .to_string();
        db.execute(
            "INSERT INTO templates(id,project_id,name,payload,version,updated_at) VALUES('v2t','p1','V2',?1,1,'now')",
            params![historical],
        )
        .unwrap();
        let error = export_template_in(&db, "v2t").unwrap_err();
        assert!(error.contains("v2"), "{error}");
    }

    #[test]
    fn unknown_formats_and_v2_writes_are_rejected() {
        let mut db = memory_db();
        let documents = [
            r#"{"format":"unknown","payload":"{}"}"#.to_string(),
            json!({"format": "forge-template-v2", "payload": {"version": 2}}).to_string(),
        ];
        for document in documents {
            let transaction = db.transaction().unwrap();
            let error = import_template_in(&transaction, &document, "p1").unwrap_err();
            assert!(!error.contains("marker"));
            transaction.rollback().unwrap();
        }
        assert_eq!(crate::domain::artifact_projection::DEFAULT_WRITE_VERSION, 1);
    }
}
