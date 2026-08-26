# Project API Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Project-scoped multi-document OpenAPI management so generation and runtime calls cannot mix unrelated services.

**Architecture:** SQLite owns Projects, API Documents, remembered generation selections, and explicit artifact-document references. PageSpec operation bindings carry `apiDocumentId`; Rust resolves persisted authorization and credentials for every runtime request. React loads one Project workspace at a time and passes only explicitly selected documents to generation.

**Tech Stack:** Rust, rusqlite, Tauri 2, React 19, TypeScript, Zustand, Node test runner.

---

### Task 1: Database schema and migration

**Files:**
- Modify: `src-tauri/src/repositories/migrations.rs`
- Test: `src-tauri/src/repositories/migrations.rs`

Add migration v4 with `projects`, `api_documents`, `template_api_documents`, and `generation_session_api_documents`. Add `project_id` to templates and sessions, create a Default Project, migrate the singleton business connection into one legacy API Document, and link existing artifacts. Verify fresh and v3 databases retain records and reach v4.

### Task 2: Project and API Document repository

**Files:**
- Create: `src-tauri/src/repositories/projects.rs`
- Modify: `src-tauri/src/repositories/mod.rs`
- Modify: `src-tauri/src/app.rs`

Implement list/create/rename/delete Project commands, remembered document selection, list/save/enable/delete API Document commands, and reference-protected deletion. Validate names, ownership, enabled selections, and JSON payloads.

### Task 3: Project-scoped artifacts

**Files:**
- Modify: `src-tauri/src/repositories/storage.rs`
- Modify: `src-tauri/src/app.rs`
- Modify: `src/lib/tauri/storage.ts`
- Modify: `src/features/workbench/useWorkbenchPersistence.ts`

Require `projectId` for template and generation-session persistence, synchronize their API Document reference rows transactionally, and filter all lists by current Project.

### Task 4: Document-aware generation and PageSpec

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src-tauri/src/domain/page_spec.rs`
- Modify: `src-tauri/src/services/model_provider.rs`
- Modify: `src/features/connections/openApiOperations.ts`
- Modify: `src/features/workbench/modelRequest.ts`
- Modify: `src/features/workbench/PromptComposer.ts`
- Test: `tests/promptComposer.test.ts`

Add `apiDocumentId` to operation and batch bindings. Build one namespaced model context from explicitly selected documents and validate the full document/method/path/operation tuple.

### Task 5: Runtime request isolation

**Files:**
- Modify: `src-tauri/src/services/business_api.rs`
- Modify: `src/store/workbenchStore.ts`
- Modify: `src/features/pages/pageOperations.ts`
- Modify: `src/features/pages/GeneratedPage.tsx`
- Modify: `src/features/pages/MutationPanel.tsx`

Resolve every request through persisted `projectId` and `apiDocumentId`. Ignore client credential configuration, reject disabled or cross-project documents, and require an unambiguous legacy match when an old PageSpec lacks a document ID.

### Task 6: Project and document UI

**Files:**
- Create: `src/features/projects/useProjectWorkspace.ts`
- Create: `src/features/projects/ProjectSwitcher.tsx`
- Modify: `src/features/workbench/WorkbenchSidebar.tsx`
- Modify: `src/features/openapi/OpenApiPage.tsx`
- Modify: `src/features/business/BusinessPage.tsx`
- Modify: `src/features/workbench/PromptGenerator.tsx`
- Modify: `src/features/workbench/Workbench.tsx`
- Modify: `src/route.css`

Add project switching and management, per-project document CRUD and enable controls, active-document business settings, and remembered generation checkboxes. Keep all controls compact and responsive.

### Task 7: Full verification

Run `cargo test --lib`, `npm test`, and `npm run build`. Start `npm run tauri:dev`, verify migration, project switching, multi-document selection, protected deletion, and employee API calls, then stop the development service while leaving the backend on port 3000 running.
