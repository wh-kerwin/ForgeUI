use crate::{
    domain::page_spec::{validate, PageSpec},
    repositories::database,
};
use rusqlite::params;

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
    model_id: String,
    prompt: String,
    payload: String,
) -> Result<(), String> {
    let spec: PageSpec =
        serde_json::from_str(&payload).map_err(|e| format!("页面 DSL 无效：{e}"))?;
    validate(&spec)?;
    let db = database::open()?;
    db.execute("INSERT INTO generation_sessions(id,model_id,prompt,payload,created_at) VALUES(?1,?2,?3,?4,datetime('now'))", params![id, model_id, prompt, payload]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_generation_sessions() -> Result<Vec<String>, String> {
    let db = database::open()?;
    let mut statement = db.prepare("SELECT json_object('id',id,'modelId',model_id,'prompt',prompt,'payload',payload,'createdAt',created_at) FROM generation_sessions ORDER BY created_at DESC LIMIT 100").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
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
    name: String,
    payload: String,
    model_id: Option<String>,
) -> Result<(), String> {
    let mut db = database::open()?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    transaction.execute("INSERT INTO templates (id,name,payload,model_id,version,updated_at) VALUES (?1,?2,?3,?4,1,datetime('now')) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,model_id=excluded.model_id,version=templates.version+1,updated_at=excluded.updated_at", params![id, name, payload, model_id]).map_err(|e| e.to_string())?;
    let version: i64 = transaction
        .query_row(
            "SELECT version FROM templates WHERE id=?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    transaction.execute("INSERT OR REPLACE INTO template_versions(template_id,version,payload,created_at) VALUES(?1,?2,?3,datetime('now'))", params![id, version, payload]).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
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

pub fn load_templates() -> Result<Vec<String>, String> {
    let db = database::open()?;
    let mut statement = db.prepare("SELECT json_object('id',id,'name',name,'payload',payload,'modelId',model_id,'version',version,'updatedAt',updated_at) FROM templates ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
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
        .query_map(params![id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn restore_template_version(id: String, version: i64) -> Result<(), String> {
    let db = database::open()?;
    let payload: String = db
        .query_row(
            "SELECT payload FROM template_versions WHERE template_id=?1 AND version=?2",
            params![id, version],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE templates SET payload=?2,version=version+1,updated_at=datetime('now') WHERE id=?1",
        params![id, payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn export_template(id: String) -> Result<String, String> {
    let db = database::open()?;
    db.query_row("SELECT json_object('format','forge-template-v1','id',id,'name',name,'payload',payload,'version',version) FROM templates WHERE id=?1", params![id], |row| row.get(0)).map_err(|error| format!("模板不存在：{error}"))
}

pub fn import_template(document: String) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(&document).map_err(|e| format!("模板 JSON 无效：{e}"))?;
    if value.get("format").and_then(|item| item.as_str()) != Some("forge-template-v1") {
        return Err("不支持的模板格式".into());
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
    let page_spec: PageSpec =
        serde_json::from_str(payload).map_err(|e| format!("页面 DSL 无效：{e}"))?;
    validate(&page_spec)?;
    save_template(format!("imported-{id}"), name.into(), payload.into(), None)
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
