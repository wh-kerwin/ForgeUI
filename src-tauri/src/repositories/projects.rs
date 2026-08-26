use crate::repositories::database;
use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub selected_api_document_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDocumentPayload {
    pub spec: serde_json::Value,
    pub auth: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDocumentRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub payload: ApiDocumentPayload,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_projects() -> Result<Vec<ProjectRecord>, String> {
    let db = database::open()?;
    list_projects_with_db(&db)
}

pub fn create_project(id: String, name: String) -> Result<ProjectRecord, String> {
    let db = database::open()?;
    create_project_with_db(&db, &id, &name)
}

pub fn rename_project(id: String, name: String) -> Result<(), String> {
    let db = database::open()?;
    rename_project_with_db(&db, &id, &name)
}

fn rename_project_with_db(db: &Connection, id: &str, name: &str) -> Result<(), String> {
    validate_id(id, "项目")?;
    let name = validate_name(name, "项目")?;
    let affected = db
        .execute(
            "UPDATE projects SET name=?2,updated_at=datetime('now') WHERE id=?1",
            params![id, name],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("项目不存在".into());
    }
    Ok(())
}

pub fn delete_project(id: String) -> Result<(), String> {
    let mut db = database::open()?;
    delete_project_with_db(&mut db, &id)
}

pub fn set_project_selected_api_documents(
    project_id: String,
    api_document_ids: Vec<String>,
) -> Result<(), String> {
    let db = database::open()?;
    set_selected_with_db(&db, &project_id, api_document_ids)
}

pub fn list_api_documents(project_id: String) -> Result<Vec<ApiDocumentRecord>, String> {
    let db = database::open()?;
    list_api_documents_with_db(&db, &project_id)
}

pub fn save_api_document(
    id: String,
    project_id: String,
    name: String,
    payload: String,
    enabled: bool,
) -> Result<ApiDocumentRecord, String> {
    let mut db = database::open()?;
    save_api_document_with_db(&mut db, &id, &project_id, &name, &payload, enabled)
}

pub fn set_api_document_enabled(
    project_id: String,
    api_document_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut db = database::open()?;
    set_enabled_with_db(&mut db, &project_id, &api_document_id, enabled)
}

pub fn delete_api_document(project_id: String, api_document_id: String) -> Result<(), String> {
    let mut db = database::open()?;
    delete_api_document_with_db(&mut db, &project_id, &api_document_id)
}

pub fn resolve_api_document(
    project_id: &str,
    api_document_id: &str,
) -> Result<ApiDocumentRecord, String> {
    validate_id(project_id, "项目")?;
    validate_id(api_document_id, "API 文档")?;
    let db = database::open()?;
    load_api_document_with_db(&db, project_id, api_document_id, true)
}

fn list_projects_with_db(db: &Connection) -> Result<Vec<ProjectRecord>, String> {
    let mut statement = db
        .prepare(
            "SELECT id,name,selected_api_document_ids,created_at,updated_at
             FROM projects ORDER BY created_at ASC,id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], project_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn create_project_with_db(db: &Connection, id: &str, name: &str) -> Result<ProjectRecord, String> {
    validate_id(id, "项目")?;
    let name = validate_name(name, "项目")?;
    db.execute(
        "INSERT INTO projects(id,name,selected_api_document_ids,created_at,updated_at)
         VALUES(?1,?2,'[]',datetime('now'),datetime('now'))",
        params![id, name],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(ref sqlite, _)
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "项目 ID 已存在".to_owned()
        }
        _ => error.to_string(),
    })?;
    load_project_with_db(db, id)
}

fn delete_project_with_db(db: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "项目")?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    ensure_project_exists(&transaction, id)?;
    let document_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM api_documents WHERE project_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let template_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM templates WHERE project_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let session_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM generation_sessions WHERE project_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if document_count + template_count + session_count > 0 {
        return Err(format!(
            "项目仍包含 {document_count} 个 API 文档、{template_count} 个页面模板和 {session_count} 条生成历史，请先清理后再删除"
        ));
    }
    transaction
        .execute("DELETE FROM projects WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

fn set_selected_with_db(
    db: &Connection,
    project_id: &str,
    api_document_ids: Vec<String>,
) -> Result<(), String> {
    validate_id(project_id, "项目")?;
    ensure_project_exists(db, project_id)?;
    let mut unique_ids = Vec::with_capacity(api_document_ids.len());
    let mut seen = HashSet::new();
    for id in api_document_ids {
        validate_id(&id, "API 文档")?;
        if seen.insert(id.clone()) {
            unique_ids.push(id);
        }
    }
    for id in &unique_ids {
        let selectable: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM api_documents WHERE id=?1 AND project_id=?2 AND enabled=1)",
                params![id, project_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !selectable {
            return Err(format!("API 文档 {id} 不属于当前项目或已停用"));
        }
    }
    let serialized = serde_json::to_string(&unique_ids).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE projects SET selected_api_document_ids=?2,updated_at=datetime('now') WHERE id=?1",
        params![project_id, serialized],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_api_documents_with_db(
    db: &Connection,
    project_id: &str,
) -> Result<Vec<ApiDocumentRecord>, String> {
    validate_id(project_id, "项目")?;
    ensure_project_exists(db, project_id)?;
    let mut statement = db
        .prepare(
            "SELECT id,project_id,name,payload,enabled,created_at,updated_at
             FROM api_documents WHERE project_id=?1 ORDER BY updated_at DESC,id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([project_id], api_document_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn save_api_document_with_db(
    db: &mut Connection,
    id: &str,
    project_id: &str,
    name: &str,
    payload: &str,
    enabled: bool,
) -> Result<ApiDocumentRecord, String> {
    validate_id(id, "API 文档")?;
    validate_id(project_id, "项目")?;
    let name = validate_name(name, "API 文档")?;
    let payload = validate_payload(payload)?;
    let serialized = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    ensure_project_exists(&transaction, project_id)?;
    let existing_project = transaction
        .query_row(
            "SELECT project_id FROM api_documents WHERE id=?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existing_project
        .as_deref()
        .is_some_and(|owner| owner != project_id)
    {
        return Err("API 文档已属于其他项目，不能跨项目覆盖".into());
    }
    transaction
        .execute(
            "INSERT INTO api_documents(id,project_id,name,payload,enabled,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,datetime('now'),datetime('now'))
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,
                enabled=excluded.enabled,updated_at=excluded.updated_at",
            params![id, project_id, name, serialized, enabled],
        )
        .map_err(|e| e.to_string())?;
    if !enabled {
        remove_selected_document(&transaction, project_id, id)?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    load_api_document_with_db(db, project_id, id, false)
}

fn set_enabled_with_db(
    db: &mut Connection,
    project_id: &str,
    api_document_id: &str,
    enabled: bool,
) -> Result<(), String> {
    validate_id(project_id, "项目")?;
    validate_id(api_document_id, "API 文档")?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    let affected = transaction
        .execute(
            "UPDATE api_documents SET enabled=?3,updated_at=datetime('now')
             WHERE id=?1 AND project_id=?2",
            params![api_document_id, project_id, enabled],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("API 文档不存在或不属于当前项目".into());
    }
    if !enabled {
        remove_selected_document(&transaction, project_id, api_document_id)?;
    }
    transaction.commit().map_err(|e| e.to_string())
}

fn delete_api_document_with_db(
    db: &mut Connection,
    project_id: &str,
    api_document_id: &str,
) -> Result<(), String> {
    validate_id(project_id, "项目")?;
    validate_id(api_document_id, "API 文档")?;
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    load_api_document_with_db(&transaction, project_id, api_document_id, false)?;

    let mut statement = transaction
        .prepare(
            "SELECT t.name FROM templates t
             JOIN template_api_documents r ON r.template_id=t.id
             WHERE r.api_document_id=?1 ORDER BY t.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let template_names = statement
        .query_map([api_document_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(statement);
    let session_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM generation_session_api_documents WHERE api_document_id=?1",
            [api_document_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !template_names.is_empty() || session_count > 0 {
        let template_summary = if template_names.is_empty() {
            "无页面模板".to_owned()
        } else {
            format!(
                "{} 个页面模板（{}）",
                template_names.len(),
                template_names.join("、")
            )
        };
        return Err(format!(
            "API 文档仍被 {template_summary} 和 {session_count} 条生成历史引用，请先删除或解除这些引用"
        ));
    }
    remove_selected_document(&transaction, project_id, api_document_id)?;
    transaction
        .execute(
            "DELETE FROM api_documents WHERE id=?1 AND project_id=?2",
            params![api_document_id, project_id],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

fn load_project_with_db(db: &Connection, id: &str) -> Result<ProjectRecord, String> {
    db.query_row(
        "SELECT id,name,selected_api_document_ids,created_at,updated_at FROM projects WHERE id=?1",
        [id],
        project_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "项目不存在".into())
}

fn load_api_document_with_db(
    db: &Connection,
    project_id: &str,
    api_document_id: &str,
    require_enabled: bool,
) -> Result<ApiDocumentRecord, String> {
    let mut query = "SELECT id,project_id,name,payload,enabled,created_at,updated_at
                     FROM api_documents WHERE id=?1 AND project_id=?2"
        .to_owned();
    if require_enabled {
        query.push_str(" AND enabled=1");
    }
    db.query_row(
        &query,
        params![api_document_id, project_id],
        api_document_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| {
        if require_enabled {
            "API 文档不存在、不属于当前项目或已停用".into()
        } else {
            "API 文档不存在或不属于当前项目".into()
        }
    })
}

fn ensure_project_exists(db: &Connection, id: &str) -> Result<(), String> {
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("项目不存在".into());
    }
    Ok(())
}

fn remove_selected_document(
    db: &Connection,
    project_id: &str,
    api_document_id: &str,
) -> Result<(), String> {
    let project = load_project_with_db(db, project_id)?;
    let selected = project
        .selected_api_document_ids
        .into_iter()
        .filter(|id| id != api_document_id)
        .collect::<Vec<_>>();
    let serialized = serde_json::to_string(&selected).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE projects SET selected_api_document_ids=?2,updated_at=datetime('now') WHERE id=?1",
        params![project_id, serialized],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 120
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("{label} ID 格式无效"));
    }
    Ok(())
}

fn validate_name<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 {
        return Err(format!("{label}名称不能为空且不能超过 120 个字符"));
    }
    Ok(value)
}

fn validate_payload(payload: &str) -> Result<ApiDocumentPayload, String> {
    let payload: ApiDocumentPayload =
        serde_json::from_str(payload).map_err(|e| format!("API 文档配置 JSON 无效：{e}"))?;
    if !payload.spec.is_object() || !payload.auth.is_object() {
        return Err("API 文档配置必须包含对象类型的 spec 和 auth".into());
    }
    Ok(payload)
}

fn project_from_row(row: &Row<'_>) -> rusqlite::Result<ProjectRecord> {
    let selected: String = row.get(2)?;
    let selected_api_document_ids = serde_json::from_str(&selected).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, Type::Text, Box::new(error))
    })?;
    Ok(ProjectRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        selected_api_document_ids,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn api_document_from_row(row: &Row<'_>) -> rusqlite::Result<ApiDocumentRecord> {
    let payload: String = row.get(3)?;
    let payload = serde_json::from_str(&payload).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, Type::Text, Box::new(error))
    })?;
    Ok(ApiDocumentRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        payload,
        enabled: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::migrations::{self, DEFAULT_PROJECT_ID};

    fn database() -> Connection {
        let db = Connection::open_in_memory().expect("in-memory database");
        db.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        migrations::apply(&db).expect("schema");
        db
    }

    fn payload(title: &str) -> String {
        serde_json::json!({
            "spec": { "title": title, "api_base_url": "http://localhost:3000/" },
            "auth": { "type": "bearer", "secretRef": "employee-secret" }
        })
        .to_string()
    }

    #[test]
    fn projects_and_enabled_document_selection_are_scoped() {
        let mut db = database();
        create_project_with_db(&db, "finance", " 财务项目 ").expect("project");
        save_api_document_with_db(
            &mut db,
            "employees",
            "finance",
            "员工服务",
            &payload("员工服务"),
            true,
        )
        .expect("document");
        save_api_document_with_db(
            &mut db,
            "disabled",
            "finance",
            "停用服务",
            &payload("停用服务"),
            false,
        )
        .expect("disabled document");

        set_selected_with_db(&db, "finance", vec!["employees".into(), "employees".into()])
            .expect("selection");
        assert_eq!(
            load_project_with_db(&db, "finance")
                .expect("project")
                .selected_api_document_ids,
            vec!["employees"]
        );
        assert!(set_selected_with_db(&db, "finance", vec!["disabled".into()]).is_err());
        assert!(set_selected_with_db(&db, DEFAULT_PROJECT_ID, vec!["employees".into()]).is_err());

        set_enabled_with_db(&mut db, "finance", "employees", false).expect("disable");
        assert!(load_project_with_db(&db, "finance")
            .expect("project")
            .selected_api_document_ids
            .is_empty());
        assert!(load_api_document_with_db(&db, "finance", "employees", true).is_err());
    }

    #[test]
    fn document_deletion_reports_referencing_artifacts() {
        let mut db = database();
        create_project_with_db(&db, "hr", "人事项目").expect("project");
        save_api_document_with_db(
            &mut db,
            "employees",
            "hr",
            "员工服务",
            &payload("员工服务"),
            true,
        )
        .expect("document");
        db.execute(
            "INSERT INTO templates(id,name,payload,version,updated_at,project_id)
             VALUES('employee-page','员工管理','{}',1,datetime('now'),'hr')",
            [],
        )
        .expect("template");
        db.execute(
            "INSERT INTO generation_sessions(id,model_id,prompt,payload,created_at,project_id)
             VALUES('employee-session','model','员工页面','{}',datetime('now'),'hr')",
            [],
        )
        .expect("session");
        db.execute(
            "INSERT INTO template_api_documents VALUES('employee-page','employees')",
            [],
        )
        .expect("template reference");
        db.execute(
            "INSERT INTO generation_session_api_documents VALUES('employee-session','employees')",
            [],
        )
        .expect("session reference");

        let error = delete_api_document_with_db(&mut db, "hr", "employees")
            .expect_err("referenced document must be protected");
        assert!(error.contains("员工管理"));
        assert!(error.contains("1 条生成历史"));
        assert!(delete_project_with_db(&mut db, "hr").is_err());
    }

    #[test]
    fn payload_and_cross_project_overwrite_are_rejected() {
        let mut db = database();
        create_project_with_db(&db, "one", "项目一").expect("project one");
        create_project_with_db(&db, "two", "项目二").expect("project two");
        assert!(save_api_document_with_db(
            &mut db,
            "bad",
            "one",
            "错误文档",
            r#"{"spec":{}}"#,
            true,
        )
        .is_err());
        save_api_document_with_db(
            &mut db,
            "shared-id",
            "one",
            "服务一",
            &payload("服务一"),
            true,
        )
        .expect("first document");
        let error = save_api_document_with_db(
            &mut db,
            "shared-id",
            "two",
            "服务二",
            &payload("服务二"),
            true,
        )
        .expect_err("cross-project overwrite");
        assert!(error.contains("其他项目"));
    }

    #[test]
    fn empty_project_can_be_renamed_and_deleted() {
        let mut db = database();
        create_project_with_db(&db, "temporary", "临时项目").expect("project");
        rename_project_with_db(&db, "temporary", " 归档项目 ").expect("rename");
        let projects = list_projects_with_db(&db).expect("projects");
        assert!(projects
            .iter()
            .any(|project| project.id == "temporary" && project.name == "归档项目"));

        delete_project_with_db(&mut db, "temporary").expect("delete empty project");
        assert!(load_project_with_db(&db, "temporary").is_err());
    }

    #[test]
    fn unreferenced_document_can_be_resolved_and_deleted() {
        let mut db = database();
        create_project_with_db(&db, "catalog", "接口项目").expect("project");
        save_api_document_with_db(
            &mut db,
            "catalog-api",
            "catalog",
            "目录服务",
            &payload("目录服务"),
            true,
        )
        .expect("document");
        let documents = list_api_documents_with_db(&db, "catalog").expect("documents");
        assert_eq!(documents.len(), 1);
        let resolved = load_api_document_with_db(&db, "catalog", "catalog-api", true)
            .expect("runtime document");
        assert_eq!(resolved.payload.spec["title"], "目录服务");

        delete_api_document_with_db(&mut db, "catalog", "catalog-api").expect("delete document");
        assert!(list_api_documents_with_db(&db, "catalog")
            .expect("documents")
            .is_empty());
    }
}
