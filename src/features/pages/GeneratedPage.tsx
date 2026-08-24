import React, { useEffect, useState } from "react";
import type { PageSpec } from "../../types/domain";
import { DataTable } from "./DataTable";
import { PageExportActions } from "./PageExportActions";
import { StatChart } from "./StatChart";
import { PageRefineBox } from "./PageRefineBox";
import { operationForRole, pageOperations } from "./pageOperations";
import { useLanguage } from "../../i18n/LanguageProvider";

export function GeneratedPage({
  page,
  operations,
  detail,
  onDetail,
  onSaved,
  onQuery,
  onMutation,
  onDelete,
  querying,
  modelId,
  templateId,
  templateName,
  onRefine,
  refining,
}: {
  page: PageSpec;
  operations: string[];
  detail: Record<string, unknown> | null;
  onDetail: (path: string, id: string, operationKey: string) => void;
  onSaved: () => void;
  onQuery: (filters: Record<string, string>, operationKey?: string) => void;
  onMutation: (method: string, path: string, body: string, operationKey: string) => void;
  onDelete: (path: string, id: string, operationKey: string) => void;
  querying: boolean;
  modelId?: string;
  templateId?: string;
  templateName?: string;
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
}) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [pageNumber, setPageNumber] = useState(1);
  const [form, setForm] = useState("{\n  \n}");
  const [deleteId, setDeleteId] = useState("");
  const [editForm, setEditForm] = useState('{\n  "id": ""\n}');
  const [detailId, setDetailId] = useState("");
  const [localDetail, setLocalDetail] = useState<Record<string, string> | null>(null);
  const [editingRow, setEditingRow] = useState<string[] | null>(null);
  const [localRows, setLocalRows] = useState(page.rows);
  const [deletingRow, setDeletingRow] = useState<string[] | null>(null);
  useEffect(() => setLocalRows(page.rows), [page.rows]);
  const boundOperations = pageOperations(page, operations);
  const listOperation = operationForRole(page, boundOperations, "list", "GET");
  const createOperation = operationForRole(page, boundOperations, "create", "POST");
  const deleteOperation = operationForRole(page, boundOperations, "delete", "DELETE", true);
  const detailOperation = operationForRole(page, boundOperations, "detail", "GET", true);
  const editOperation = operationForRole(page, boundOperations, "update", "PUT", true) || operationForRole(page, boundOperations, "update", "PATCH", true);
  const editMethod = editOperation?.startsWith("PATCH ") ? "PATCH" : "PUT";
  const rowRecord = (row: string[]) => Object.fromEntries(page.columns.map((column, index) => [column, row[index] || ""]));
  const rowId = (row: string[]) => row[0] || "";
  return (
    <section className="generated-page">
      <div className="panel-head">
        <div>
          <span className="eyebrow">GENERATED PAGE · UI DSL v1</span>
          <h3>{page.title}</h3>
          <p className="muted">{page.description}</p>
        </div>
        <PageExportActions page={page} modelId={modelId} templateId={templateId} templateName={templateName} onSaved={onSaved} />
      </div>
      <div className="filter-row">
        {page.filters.map((filter) => (
          <input
            key={filter}
            placeholder={filter}
            value={filters[filter] || ""}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                [filter]: event.target.value,
              }))
            }
          />
        ))}
        <button
          className="secondary"
          onClick={() => {
            setPageNumber(1);
            onQuery({ ...filters, page: "1", pageSize: "100" }, listOperation);
          }}
        >
          {querying ? (zh ? "加载中…" : "Loading…") : (zh ? "查询" : "Query")}
        </button>
      </div>
      <div className="stats-row">
        {page.stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
      <StatChart stats={page.stats} />
      <DataTable columns={page.columns} rows={localRows} onView={(row) => { if (detailOperation && rowId(row)) { setDetailId(rowId(row)); onDetail(detailOperation.split(" · ")[0].replace(/^GET\s+/, ""), rowId(row), detailOperation); } else { setLocalDetail(rowRecord(row)); } }} onEdit={(row) => { setEditingRow(row); setEditForm(JSON.stringify(rowRecord(row), null, 2)); }} onDelete={deleteOperation ? (row) => setDeletingRow(row) : undefined} />
      <PageRefineBox onRefine={onRefine} refining={refining} />
      <div className="pagination">
        <button
          className="secondary"
          disabled={pageNumber <= 1 || querying}
          onClick={() => {
            const next = Math.max(1, pageNumber - 1);
            setPageNumber(next);
            onQuery({ ...filters, page: String(next), pageSize: "100" }, listOperation);
          }}
        >
          {zh ? "上一页" : "Previous"}
        </button>
        <span>{zh ? `第 ${pageNumber} 页` : `Page ${pageNumber}`}</span>
        <button
          className="secondary"
          disabled={querying}
          onClick={() => {
            const next = pageNumber + 1;
            setPageNumber(next);
            onQuery({ ...filters, page: String(next), pageSize: "100" }, listOperation);
          }}
        >
          {zh ? "下一页" : "Next"}
        </button>
      </div>
      {detailOperation && (
        <div className="mutation-box">
          <span className="eyebrow">DETAIL PANEL</span>
          <h4>{zh ? "查看详情" : "View details"}</h4>
          <div className="delete-row">
            <input
              placeholder={zh ? "记录 ID" : "Record ID"}
              value={detailId}
              onChange={(event) => setDetailId(event.target.value)}
            />
            <button
              className="secondary"
              onClick={() =>
                onDetail(
                  detailOperation.split(" · ")[0].replace(/^GET\s+/, ""),
                  detailId,
                  detailOperation,
                )
              }
            >
              {zh ? "加载详情" : "Load details"}
            </button>
          </div>
          {detail && (
            <dl className="detail-grid">
              {Object.entries(detail).map(([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value ?? "")}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
      {localDetail && !detailOperation && <div className="detail-grid local-detail">{Object.entries(localDetail).map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</div>}
      {editingRow && <div className="edit-dialog-backdrop" role="presentation" onClick={() => setEditingRow(null)}><div className="edit-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="panel-head"><div><span className="eyebrow">EDIT RECORD</span><h4>{zh ? "编辑记录" : "Edit record"}</h4></div><button type="button" className="icon-btn" onClick={() => setEditingRow(null)}>×</button></div><textarea value={editForm} onChange={(event) => setEditForm(event.target.value)} spellCheck={false}/><div className="modal-actions"><button className="secondary" onClick={() => setEditingRow(null)}>{zh ? "取消" : "Cancel"}</button><button className="primary" onClick={() => { if (editOperation) { onMutation(editMethod, editOperation.split(" · ")[0].replace(/^(PUT|PATCH)\s+/, "").replace(/\{[^}]+\}/, encodeURIComponent(rowId(editingRow))), editForm, editOperation); } else { try { const next = JSON.parse(editForm) as Record<string, unknown>; setLocalRows((rows) => rows.map((row) => row === editingRow ? page.columns.map((column) => String(next[column] ?? "")) : row)); } catch { return; } } setEditingRow(null); }}>{zh ? "保存编辑" : "Save changes"}</button></div></div></div>}
      {deletingRow && deleteOperation && <div className="edit-dialog-backdrop" role="presentation" onClick={() => setDeletingRow(null)}><div className="edit-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="panel-head"><div><span className="eyebrow">DELETE · CONFIRMATION</span><h4>{zh ? "确认删除" : "Confirm deletion"}</h4></div><button type="button" className="icon-btn" onClick={() => setDeletingRow(null)}>×</button></div><p className="modal-intro">{zh ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。` : `Delete record ${rowId(deletingRow)}? This cannot be undone.`}</p><div className="modal-actions"><button className="secondary" onClick={() => setDeletingRow(null)}>{zh ? "取消" : "Cancel"}</button><button className="danger" onClick={() => { onDelete(deleteOperation.split(" · ")[0].replace(/^DELETE\s+/, ""), rowId(deletingRow), deleteOperation); setDeletingRow(null); }}>{zh ? "确认删除" : "Delete"}</button></div></div></div>}
      {createOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">CREATE FORM · USER ACTION REQUIRED</span>
            <h4>{zh ? "新增记录" : "Create record"}</h4>
          </div>
          <textarea
            value={form}
            onChange={(event) => setForm(event.target.value)}
            spellCheck={false}
          />
          <button
            className="primary"
            onClick={() =>
              onMutation(
                "POST",
                createOperation.split(" · ")[0].replace(/^POST\s+/, ""),
                form,
                createOperation,
              )
            }
          >
            {zh ? "提交新增" : "Create"}
          </button>
        </div>
      )}
      {editOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">EDIT FORM · USER ACTION REQUIRED</span>
            <h4>{zh ? "编辑记录" : "Edit record"}</h4>
          </div>
          <textarea
            value={editForm}
            onChange={(event) => setEditForm(event.target.value)}
            spellCheck={false}
          />
          <button
            className="primary"
            onClick={() =>
              onMutation(
                editMethod,
                editOperation.split(" · ")[0].replace(/^(PUT|PATCH)\s+/, ""),
                editForm,
                editOperation,
              )
            }
          >
            {zh ? "提交编辑" : "Save changes"}
          </button>
        </div>
      )}
      {deleteOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">DELETE · CONFIRMATION REQUIRED</span>
            <h4>{zh ? "删除记录" : "Delete record"}</h4>
          </div>
          <div className="delete-row">
            <input
              placeholder={zh ? "记录 ID" : "Record ID"}
              value={deleteId}
              onChange={(event) => setDeleteId(event.target.value)}
            />
            <button
              className="danger"
              onClick={() =>
                onDelete(
                  deleteOperation.split(" · ")[0].replace(/^DELETE\s+/, ""),
                deleteId,
                deleteOperation,
                )
              }
            >
              {zh ? "删除" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
