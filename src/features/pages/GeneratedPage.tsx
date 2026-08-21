import React, { useState } from "react";
import type { PageSpec } from "../../types/domain";
import { DataTable } from "./DataTable";
import { PageExportActions } from "./PageExportActions";
import { StatChart } from "./StatChart";
import { PageRefineBox } from "./PageRefineBox";
import { operationForRole, pageOperations } from "./pageOperations";

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
  onRefine: (instruction: string) => Promise<void>;
  refining: boolean;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [pageNumber, setPageNumber] = useState(1);
  const [form, setForm] = useState("{\n  \n}");
  const [deleteId, setDeleteId] = useState("");
  const [editForm, setEditForm] = useState('{\n  "id": ""\n}');
  const [detailId, setDetailId] = useState("");
  const boundOperations = pageOperations(page, operations);
  const listOperation = operationForRole(page, boundOperations, "list", "GET");
  const createOperation = operationForRole(page, boundOperations, "create", "POST");
  const deleteOperation = operationForRole(page, boundOperations, "delete", "DELETE", true);
  const detailOperation = operationForRole(page, boundOperations, "detail", "GET", true);
  const editOperation = operationForRole(page, boundOperations, "update", "PUT", true) || operationForRole(page, boundOperations, "update", "PATCH", true);
  const editMethod = editOperation?.startsWith("PATCH ") ? "PATCH" : "PUT";
  return (
    <section className="generated-page">
      <div className="panel-head">
        <div>
          <span className="eyebrow">GENERATED PAGE · UI DSL v1</span>
          <h3>{page.title}</h3>
          <p className="muted">{page.description}</p>
        </div>
        <PageExportActions page={page} modelId={modelId} onSaved={onSaved} />
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
          {querying ? "加载中…" : "查询"}
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
      <DataTable columns={page.columns} rows={page.rows} />
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
          上一页
        </button>
        <span>第 {pageNumber} 页</span>
        <button
          className="secondary"
          disabled={querying}
          onClick={() => {
            const next = pageNumber + 1;
            setPageNumber(next);
            onQuery({ ...filters, page: String(next), pageSize: "100" }, listOperation);
          }}
        >
          下一页
        </button>
      </div>
      {detailOperation && (
        <div className="mutation-box">
          <span className="eyebrow">DETAIL PANEL</span>
          <h4>查看详情</h4>
          <div className="delete-row">
            <input
              placeholder="记录 ID"
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
              加载详情
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
      {createOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">CREATE FORM · USER ACTION REQUIRED</span>
            <h4>新增记录</h4>
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
            提交新增
          </button>
        </div>
      )}
      {editOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">EDIT FORM · USER ACTION REQUIRED</span>
            <h4>编辑记录</h4>
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
            提交编辑
          </button>
        </div>
      )}
      {deleteOperation && (
        <div className="mutation-box">
          <div>
            <span className="eyebrow">DELETE · CONFIRMATION REQUIRED</span>
            <h4>删除记录</h4>
          </div>
          <div className="delete-row">
            <input
              placeholder="记录 ID"
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
              删除
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
