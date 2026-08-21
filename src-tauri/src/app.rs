use crate::{
    domain::page_spec::PageSpec,
    repositories::{secrets, storage},
    services::{
        business_api::{self, ApiRequest, ApiResponse},
        exporter,
        model_provider::{self, GenerateInput, ModelConfigInput, ValidationResult},
        openapi::{self, OpenApiSummary},
    },
};

#[tauri::command]
async fn validate_model_config(input: ModelConfigInput) -> Result<ValidationResult, String> {
    model_provider::validate_config(input).await
}

#[tauri::command]
async fn generate_page(input: GenerateInput) -> Result<PageSpec, String> {
    model_provider::generate_page(input).await
}

#[tauri::command]
async fn execute_api(request: ApiRequest) -> Result<ApiResponse, String> {
    business_api::execute(request).await
}

#[tauri::command]
async fn import_openapi_url(url: String) -> Result<OpenApiSummary, String> {
    openapi::import_url(url).await
}

#[tauri::command]
async fn discover_openapi_candidates(url: String) -> Result<Vec<String>, String> {
    openapi::discover_candidates(url).await
}

#[tauri::command]
fn parse_openapi_file(content: String) -> Result<OpenApiSummary, String> {
    openapi::parse(&content, "local-file")
}

#[tauri::command]
fn save_secret(secret_ref: String, value: String) -> Result<(), String> {
    secrets::save(secret_ref, value)
}

#[tauri::command]
fn delete_secret(secret_ref: String) -> Result<(), String> {
    secrets::delete(secret_ref)
}

#[tauri::command]
fn load_secret(secret_ref: String) -> Result<String, String> {
    secrets::load(&secret_ref)
}

#[tauri::command]
fn save_model_metadata(id: String, payload: String) -> Result<(), String> {
    storage::save_model_metadata(id, payload)
}

#[tauri::command]
fn load_model_metadata() -> Result<Vec<String>, String> {
    storage::load_model_metadata()
}

#[tauri::command]
fn delete_model_config(id: String) -> Result<(), String> {
    storage::delete_model_config(id)
}

#[tauri::command]
fn set_default_model(id: String) -> Result<(), String> {
    storage::set_default_model(id)
}

#[tauri::command]
fn load_default_model() -> Result<Option<String>, String> {
    storage::load_default_model()
}

#[tauri::command]
fn save_generation_session(
    id: String,
    model_id: String,
    prompt: String,
    payload: String,
) -> Result<(), String> {
    storage::save_generation_session(id, model_id, prompt, payload)
}

#[tauri::command]
fn load_generation_sessions() -> Result<Vec<String>, String> {
    storage::load_generation_sessions()
}

#[tauri::command]
fn save_business_connection(payload: String) -> Result<(), String> {
    storage::save_business_connection(payload)
}

#[tauri::command]
fn load_business_connection() -> Result<Option<String>, String> {
    storage::load_business_connection()
}

#[tauri::command]
fn save_template(
    id: String,
    name: String,
    payload: String,
    model_id: Option<String>,
) -> Result<(), String> {
    storage::save_template(id, name, payload, model_id)
}

#[tauri::command]
fn load_templates() -> Result<Vec<String>, String> {
    storage::load_templates()
}

#[tauri::command]
fn delete_template(id: String) -> Result<(), String> {
    storage::delete_template(id)
}

#[tauri::command]
fn load_template_versions(id: String) -> Result<Vec<String>, String> {
    storage::load_template_versions(id)
}

#[tauri::command]
fn restore_template_version(id: String, version: i64) -> Result<(), String> {
    storage::restore_template_version(id, version)
}

#[tauri::command]
fn export_template(id: String) -> Result<String, String> {
    storage::export_template(id)
}

#[tauri::command]
fn import_template(document: String) -> Result<(), String> {
    storage::import_template(document)
}

#[tauri::command]
fn export_xlsx(page: PageSpec) -> Result<Vec<u8>, String> {
    exporter::xlsx(page)
}

#[tauri::command]
fn backup_local_database() -> Result<String, String> {
    crate::repositories::database::backup()
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        return Err("自动更新未启用；请使用 updater feature 和签名配置构建发布版".into());
    }
    #[cfg(feature = "updater")]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater()
            .map_err(|error| format!("初始化更新器失败：{error}"))?
            .check()
            .await
            .map_err(|error| format!("检查更新失败：{error}"))?;
        Ok(update.map(|item| item.version))
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(feature = "updater"))]
    {
        let _ = app;
        return Err("自动更新未启用；发布构建必须启用 updater feature".into());
    }
    #[cfg(feature = "updater")]
    {
        use tauri_plugin_updater::UpdaterExt;
        let Some(update) = app
            .updater()
            .map_err(|error| format!("初始化更新器失败：{error}"))?
            .check()
            .await
            .map_err(|error| format!("检查更新失败：{error}"))?
        else {
            return Ok(None);
        };
        let version = update.version.clone();
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|error| format!("下载或安装更新失败：{error}"))?;
        Ok(Some(version))
    }
}

#[tauri::command]
fn list_database_backups() -> Result<Vec<crate::repositories::database::BackupInfo>, String> {
    crate::repositories::database::list_backups()
}

#[tauri::command]
fn restore_database_backup(file_name: String) -> Result<String, String> {
    crate::repositories::database::restore_backup(file_name)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            validate_model_config,
            generate_page,
            execute_api,
            import_openapi_url,
            discover_openapi_candidates,
            parse_openapi_file,
            save_secret,
            delete_secret,
            load_secret,
            save_model_metadata,
            load_model_metadata,
            delete_model_config,
            set_default_model,
            load_default_model,
            save_generation_session,
            load_generation_sessions,
            save_business_connection,
            load_business_connection,
            save_template,
            load_templates,
            delete_template,
            load_template_versions,
            restore_template_version,
            export_template,
            import_template,
            export_xlsx,
            backup_local_database,
            list_database_backups,
            restore_database_backup,
            check_for_updates,
            install_update
        ])
        .setup(|app| {
            // Startup backup happens before the UI can mutate local state. Failure is non-fatal:
            // a first run has no database yet, and the app remains usable if storage is unavailable.
            let _ = crate::repositories::database::backup();
            #[cfg(feature = "updater")]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
