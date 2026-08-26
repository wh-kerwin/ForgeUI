import { invoke } from "@tauri-apps/api/core";
import type {
  BusinessAuth,
  ApiDocument,
  GenerationSession,
  ModelConfig,
  Project,
  TemplateRecord,
  TemplateVersion,
} from "../../types/domain";

export const isTauri = () =>
  Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );

export async function saveModelMetadata(model: ModelConfig) {
  await invoke("save_model_metadata", {
    id: model.id,
    payload: JSON.stringify({ ...model, apiKey: undefined }),
  });
}
export async function loadModelMetadata() {
  const rows = await invoke<string[]>("load_model_metadata");
  return rows.map((row) => JSON.parse(row) as ModelConfig);
}
export async function deleteModelConfig(id: string) {
  await invoke("delete_model_config", { id });
}
export async function deleteSecret(secretRef: string) {
  await invoke("delete_secret", { secretRef });
}
export async function setDefaultModel(id: string) {
  await invoke("set_default_model", { id });
}
export async function loadDefaultModel() {
  return invoke<string | null>("load_default_model");
}
export async function saveBusinessConnection(connection: BusinessAuth) {
  await invoke("save_business_connection", {
    payload: JSON.stringify(connection),
  });
}
export async function loadBusinessConnection() {
  const value = await invoke<string | null>("load_business_connection");
  return value ? (JSON.parse(value) as BusinessAuth) : null;
}
export async function saveSecret(secretRef: string, value: string) {
  await invoke("save_secret", { secretRef, value });
}
export async function loadSecret(secretRef: string) {
  return invoke<string>("load_secret", { secretRef });
}
export async function listProjects() {
  return invoke<Project[]>("list_projects");
}
export async function createProject(id: string, name: string) {
  await invoke("create_project", { id, name });
}
export async function renameProject(id: string, name: string) {
  await invoke("rename_project", { id, name });
}
export async function deleteProject(id: string) {
  await invoke("delete_project", { id });
}
export async function saveProjectDocumentSelection(projectId: string, apiDocumentIds: string[]) {
  await invoke("set_project_selected_api_documents", { projectId, apiDocumentIds });
}
export async function listApiDocuments(projectId: string) {
  const records = await invoke<Array<Omit<ApiDocument, "spec" | "auth"> & { payload: Pick<ApiDocument, "spec" | "auth"> }>>("list_api_documents", { projectId });
  return records.map(({ payload, ...record }) => ({ ...record, ...payload }));
}
export async function saveApiDocument(document: ApiDocument) {
  await invoke("save_api_document", {
    id: document.id,
    projectId: document.projectId,
    name: document.name,
    enabled: document.enabled,
    payload: JSON.stringify({ spec: document.spec, auth: document.auth }),
  });
}
export async function setApiDocumentEnabled(projectId: string, apiDocumentId: string, enabled: boolean) {
  await invoke("set_api_document_enabled", { projectId, apiDocumentId, enabled });
}
export async function deleteApiDocument(projectId: string, apiDocumentId: string) {
  await invoke("delete_api_document", { projectId, apiDocumentId });
}
export async function listTemplates(projectId: string) {
  return (await invoke<string[]>("load_templates", { projectId })).map(
    (row) => JSON.parse(row) as TemplateRecord,
  );
}
export async function deleteTemplate(id: string) {
  await invoke("delete_template", { id });
}
export async function renameTemplate(id: string, name: string) {
  await invoke("rename_template", { id, name });
}
export async function listTemplateVersions(id: string) {
  return (await invoke<string[]>("load_template_versions", { id })).map(
    (row) => JSON.parse(row) as TemplateVersion,
  );
}
export async function restoreTemplateVersion(id: string, version: number) {
  await invoke("restore_template_version", { id, version });
}
export async function listGenerationSessions(projectId: string) {
  return (await invoke<string[]>("load_generation_sessions", { projectId })).map(
    (row) => JSON.parse(row) as GenerationSession,
  );
}
export async function deleteGenerationSession(id: string) {
  await invoke("delete_generation_session", { id });
}
export async function saveGenerationSession(
  projectId: string,
  modelId: string,
  prompt: string,
  payload: string,
  apiDocumentIds: string[],
) {
  await invoke("save_generation_session", {
    id: crypto.randomUUID(),
    projectId,
    modelId,
    prompt,
    payload,
    apiDocumentIds,
  });
}
export async function backupLocalDatabase() {
  return invoke<string>("backup_local_database");
}
export type DatabaseBackup = {
  fileName: string;
  sizeBytes: number;
  modifiedAt: number;
};
export async function listDatabaseBackups() {
  return invoke<DatabaseBackup[]>("list_database_backups");
}
export async function restoreDatabaseBackup(fileName: string) {
  return invoke<string>("restore_database_backup", { fileName });
}
