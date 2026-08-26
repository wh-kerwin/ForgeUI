import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { FieldSchema, PageSpec } from "../../types/domain";
import { FieldRenderer } from "./FieldRenderer";
import type { ResolvedInteraction } from "./interactionModes";
import { usesOverlay, usesRedirect } from "./interactionModes";
import { Modal } from "./Modal";
import { serializeFieldValues, validateField, visibleFieldSchemas, type FieldErrors } from "./formValidation";

type Props = {
  page: PageSpec;
  zh: boolean;
  fieldSchemas?: Record<string, FieldSchema[]>;
  interaction: ResolvedInteraction;
  createOperation?: string;
  editOperation?: string;
  deleteOperation?: string;
  detailOperation?: string;
  detail: Record<string, unknown> | null;
  localDetail: Record<string, string> | null;
  creating: boolean;
  editingRow: string[] | null;
  deletingRow: string[] | null;
  viewingRow: string[] | null;
  onCloseCreate: () => void;
  onCloseEdit: () => void;
  onCloseDelete: () => void;
  onCloseDetail: () => void;
  onRowsChange: Dispatch<SetStateAction<string[][]>>;
  onDetail: (path: string, id: string, operationKey: string) => void;
  onMutation: (method: string, path: string, body: string, operationKey: string) => void;
  onDelete: (path: string, id: string, operationKey: string, confirmed?: boolean) => void;
};

function operationPath(operation: string, method: string) {
  return operation.split(" · ")[0].replace(new RegExp(`^${method}\\s+`), "");
}

function operationId(operation?: string) {
  const parts = operation?.split(" · ") ?? [];
  return parts[parts.length - 1];
}

function presentation(mode: ResolvedInteraction[keyof ResolvedInteraction]): "dialog" | "drawer" {
  return mode === "drawer" ? "drawer" : "dialog";
}

export function MutationPanel({ page, zh, fieldSchemas, interaction, createOperation, editOperation, deleteOperation, detailOperation, detail, localDetail, creating, editingRow, deletingRow, viewingRow, onCloseCreate, onCloseEdit, onCloseDelete, onCloseDetail, onRowsChange, onDetail, onMutation, onDelete }: Props) {
  const [createForm, setCreateForm] = useState("{\n  \n}");
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [createErrors, setCreateErrors] = useState<FieldErrors>({});
  const [editForm, setEditForm] = useState('{\n  "id": ""\n}');
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [detailId, setDetailId] = useState("");
  const editMethod = editOperation?.startsWith("PATCH ") ? "PATCH" : "PUT";
  const operationFields = (operation?: string) => {
    const id = operationId(operation);
    if (!id) return [];
    const bindingFields = page.operations?.find((binding) => binding.operation_id === id)?.bodySchema;
    return bindingFields?.length ? bindingFields : fieldSchemas?.[id] ?? [];
  };
  const createFields = operationFields(createOperation);
  const editFields = operationFields(editOperation);
  const visibleCreateFields = visibleFieldSchemas(createFields, createValues);
  const visibleEditFields = visibleFieldSchemas(editFields, editValues);
  const rowRecord = (row: string[]) => Object.fromEntries(page.columns.map((column, index) => [column, row[index] || ""]));
  const rowId = (row: string[]) => row[0] || "";
  const deleteBinding = page.operations?.find((binding) => binding.operation_id === operationId(deleteOperation));

  useEffect(() => {
    if (!editingRow) return;
    const record = rowRecord(editingRow);
    setEditForm(JSON.stringify(record, null, 2));
    setEditValues(Object.fromEntries(editFields.map((field) => [field.name, String(record[field.name] ?? "")])));
    setEditErrors({});
    setFormError("");
  }, [editingRow]);

  const setFieldError = (field: FieldSchema, value: string, setter: Dispatch<SetStateAction<FieldErrors>>) => setter((current) => {
    const next = { ...current };
    const error = validateField(field, value, zh);
    if (error) next[field.name] = error;
    else delete next[field.name];
    return next;
  });

  const renderFields = (fields: FieldSchema[], values: Record<string, string>, setValues: Dispatch<SetStateAction<Record<string, string>>>, errors: FieldErrors, setErrors: Dispatch<SetStateAction<FieldErrors>>) => (
    <div className="schema-fields">{fields.map((field) => <label className="modal-form-field" key={field.name}>
      <span>{field.name}{field.required ? " *" : ""}</span>
      <FieldRenderer field={field} value={values[field.name] ?? ""} invalid={Boolean(errors[field.name])} onBlur={() => setFieldError(field, values[field.name] ?? "", setErrors)} onChange={(value) => { setValues((current) => ({ ...current, [field.name]: value })); if (errors[field.name]) setFieldError(field, value, setErrors); }} />
      {errors[field.name] ? <small className="field-error" role="alert">{errors[field.name]}</small> : field.description && <small>{field.description}</small>}
    </label>)}</div>
  );

  const rawPayload = (value: string) => {
    try {
      JSON.parse(value);
      setFormError("");
      return value;
    } catch {
      setFormError(zh ? "请输入有效的 JSON 对象" : "Enter a valid JSON object");
      return null;
    }
  };

  const submitCreate = (closeAfter: boolean) => {
    if (!createOperation) return;
    const result = createFields.length ? serializeFieldValues(visibleCreateFields, createValues, zh) : { payload: rawPayload(createForm), errors: {} };
    setCreateErrors(result.errors);
    if (!result.payload) return;
    onMutation("POST", operationPath(createOperation, "POST"), result.payload, createOperation);
    setCreateValues({});
    setCreateForm("{\n  \n}");
    if (closeAfter) onCloseCreate();
  };

  const submitEdit = (closeAfter: boolean) => {
    if (!editingRow) return;
    const result = editFields.length ? serializeFieldValues(visibleEditFields, editValues, zh) : { payload: rawPayload(editForm), errors: {} };
    setEditErrors(result.errors);
    if (!result.payload) return;
    if (editOperation) onMutation(editMethod, operationPath(editOperation, editMethod).replace(/\{[^}]+\}/, encodeURIComponent(rowId(editingRow))), result.payload, editOperation);
    else {
      const next = JSON.parse(result.payload) as Record<string, unknown>;
      onRowsChange((rows) => rows.map((row) => row === editingRow ? page.columns.map((column) => String(next[column] ?? "")) : row));
    }
    if (closeAfter) onCloseEdit();
  };

  const detailValues = viewingRow ? { ...rowRecord(viewingRow), ...(detail ?? {}) } : (detail ?? localDetail);
  const renderDetail = (values: Record<string, unknown> | null) => values && <dl className="detail-grid">{Object.entries(values).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</dd></Fragment>)}</dl>;
  const renderDeletePreview = (row: string[]) => <dl className="delete-preview">{page.columns.slice(0, 4).map((column, index) => <Fragment key={column}><dt>{column}</dt><dd>{row[index] || "-"}</dd></Fragment>)}</dl>;
  const editChanges = editingRow && visibleEditFields.map((field) => ({ name: field.name, before: rowRecord(editingRow)[field.name] ?? "", after: editValues[field.name] ?? "" })).filter((change) => change.before !== change.after);

  const createContent = <>{createFields.length ? renderFields(visibleCreateFields, createValues, setCreateValues, createErrors, setCreateErrors) : <textarea value={createForm} onChange={(event) => setCreateForm(event.target.value)} spellCheck={false} />}{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="secondary" onClick={onCloseCreate}>{zh ? "取消" : "Cancel"}</button><button className="primary" onClick={() => submitCreate(true)}>{zh ? "提交" : "Submit"}</button></div></>;
  const editContent = editingRow && <>{editFields.length ? renderFields(visibleEditFields, editValues, setEditValues, editErrors, setEditErrors) : <textarea value={editForm} onChange={(event) => setEditForm(event.target.value)} spellCheck={false} />}{editChanges && editChanges.length > 0 && <div className="edit-change-preview"><span className="eyebrow">{zh ? "本次变更" : "CHANGES"}</span>{editChanges.map((change) => <div key={change.name}><strong>{change.name}</strong><span>{change.before || "-"}</span><span aria-hidden="true">→</span><span>{change.after || "-"}</span></div>)}</div>}{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-actions"><button className="secondary" onClick={onCloseEdit}>{zh ? "取消" : "Cancel"}</button><button className="primary" onClick={() => submitEdit(true)}>{zh ? "保存编辑" : "Save changes"}</button></div></>;

  return <>
    {createOperation && interaction.create === "inline" && <div className="mutation-box"><span className="eyebrow">CREATE FORM · USER ACTION REQUIRED</span><h4>{zh ? "新增记录" : "Create record"}</h4>{createFields.length ? renderFields(visibleCreateFields, createValues, setCreateValues, createErrors, setCreateErrors) : <textarea value={createForm} onChange={(event) => setCreateForm(event.target.value)} spellCheck={false} />}{formError && <p className="form-error" role="alert">{formError}</p>}<button className="primary" onClick={() => submitCreate(false)}>{zh ? "提交新增" : "Create"}</button></div>}
    {createOperation && creating && usesRedirect(interaction.create) && <div className="redirect-operation-surface"><h4>{zh ? "新增记录" : "Create record"}</h4>{createContent}</div>}
    {editingRow && !usesOverlay(interaction.update) && <div className={usesRedirect(interaction.update) ? "redirect-operation-surface" : "mutation-box"}><h4>{zh ? "编辑记录" : "Edit record"}</h4>{editContent}</div>}
    {detailOperation && interaction.detail === "inline" && <div className="mutation-box"><span className="eyebrow">DETAIL PANEL</span><h4>{zh ? "查看详情" : "View details"}</h4><div className="delete-row"><input placeholder={zh ? "记录 ID" : "Record ID"} value={detailId} onChange={(event) => setDetailId(event.target.value)} /><button className="secondary" onClick={() => onDetail(operationPath(detailOperation, "GET"), detailId, detailOperation)}>{zh ? "加载详情" : "Load details"}</button></div>{renderDetail(detail ?? localDetail)}</div>}
    {detailOperation && viewingRow && usesRedirect(interaction.detail) && <div className="redirect-operation-surface"><h4>{zh ? "记录详情" : "Record details"}</h4>{renderDetail(detailValues)}</div>}
    {!detailOperation && localDetail && interaction.detail === "inline" && <div className="local-detail">{renderDetail(localDetail)}</div>}
    {!detailOperation && viewingRow && usesRedirect(interaction.detail) && <div className="redirect-operation-surface"><h4>{zh ? "记录详情" : "Record details"}</h4>{renderDetail(detailValues)}</div>}
    {deleteOperation && interaction.delete === "inline" && <div className="mutation-box"><span className="eyebrow">DELETE · CONFIRMATION REQUIRED</span><h4>{zh ? "删除记录" : "Delete record"}</h4>{deletingRow ? <>{renderDeletePreview(deletingRow)}<p className="modal-intro">{deleteBinding?.confirmMessage ?? (zh ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。` : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}</p><div className="modal-actions"><button className="secondary" onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</button><button className="danger" onClick={() => { onDelete(operationPath(deleteOperation, "DELETE"), rowId(deletingRow), deleteOperation, true); onCloseDelete(); }}>{zh ? "确认删除" : "Delete"}</button></div></> : <div className="delete-row"><input placeholder={zh ? "记录 ID" : "Record ID"} value={deleteId} onChange={(event) => setDeleteId(event.target.value)} /><button className="danger" onClick={() => onDelete(operationPath(deleteOperation, "DELETE"), deleteId, deleteOperation)}>{zh ? "删除" : "Delete"}</button></div>}</div>}
    {deleteOperation && deletingRow && usesRedirect(interaction.delete) && <div className="redirect-operation-surface"><h4>{zh ? "确认删除" : "Confirm deletion"}</h4>{renderDeletePreview(deletingRow)}<p className="modal-intro">{deleteBinding?.confirmMessage ?? (zh ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。` : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}</p><div className="modal-actions"><button className="secondary" onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</button><button className="danger" onClick={() => { onDelete(operationPath(deleteOperation, "DELETE"), rowId(deletingRow), deleteOperation, true); onCloseDelete(); }}>{zh ? "确认删除" : "Delete"}</button></div></div>}

    <Modal open={Boolean(creating && createOperation && usesOverlay(interaction.create))} onClose={onCloseCreate} title={`${page.title} · ${zh ? "新增" : "Create"}`} subtitle={zh ? "填写信息后提交新增记录" : "Complete the fields to create a record"} size="lg" presentation={presentation(interaction.create)} closeLabel={zh ? "关闭" : "Close"}>{createContent}</Modal>
    <Modal open={Boolean(editingRow && usesOverlay(interaction.update))} onClose={onCloseEdit} title={zh ? "编辑记录" : "Edit record"} subtitle={editingRow ? `${page.title} · ${rowId(editingRow)}` : page.title} size="lg" presentation={presentation(interaction.update)} closeLabel={zh ? "关闭" : "Close"}>{editContent}</Modal>
    <Modal open={Boolean(viewingRow && usesOverlay(interaction.detail))} onClose={onCloseDetail} title={zh ? "记录详情" : "Record details"} subtitle={viewingRow ? `${page.title} · ${rowId(viewingRow)}` : page.title} size="lg" presentation={presentation(interaction.detail)} closeLabel={zh ? "关闭" : "Close"}>{renderDetail(detailValues)}</Modal>
    <Modal open={Boolean(deletingRow && deleteOperation && usesOverlay(interaction.delete))} onClose={onCloseDelete} title={zh ? "确认删除" : "Confirm deletion"} subtitle="DELETE · CONFIRMATION" variant="danger" size="sm" presentation={presentation(interaction.delete)} closeOnBackdropClick={false} closeLabel={zh ? "关闭" : "Close"}>{deletingRow && <>{renderDeletePreview(deletingRow)}<p className="modal-intro">{deleteBinding?.confirmMessage ?? (zh ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。` : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}</p><div className="modal-actions"><button className="secondary" onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</button><button className="danger" onClick={() => { if (deleteOperation) onDelete(operationPath(deleteOperation, "DELETE"), rowId(deletingRow), deleteOperation, true); onCloseDelete(); }}>{zh ? "确认删除" : "Delete"}</button></div></>}</Modal>
  </>;
}
