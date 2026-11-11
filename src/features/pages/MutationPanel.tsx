import {
  Fragment,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Alert, Button, Drawer, Form, Input, Modal, Space } from "antd";
import type { FieldSchema, PageSpec } from "../../types/domain";
import { FieldRenderer } from "./FieldRenderer";
import type { ResolvedInteraction } from "./interactionModes";
import { usesOverlay, usesRedirect } from "./interactionModes";
import {
  serializeFieldValues,
  validateField,
  visibleFieldSchemas,
  type FieldErrors,
} from "./formValidation";
import type { RuntimeOperation } from "./pageOperations";
import type { MutationOutcome } from "./mutationOutcome";
import { recordId } from "./recordIdentity";

type Props = {
  page: PageSpec;
  zh: boolean;
  /** Loaded display columns; row values come from runtime, not the definition. */
  displayColumns?: string[];
  /** Typed raw record identity; falls back to a display-column heuristic. */
  identityForRow?: (row: string[]) => string;
  /** Bounded backend field errors, keyed by declared field name. */
  fieldErrors?: Record<string, string>;
  submitting?: boolean;
  fieldSchemas?: Record<string, FieldSchema[]>;
  interaction: ResolvedInteraction;
  createOperation?: RuntimeOperation;
  editOperation?: RuntimeOperation;
  deleteOperation?: RuntimeOperation;
  detailOperation?: RuntimeOperation;
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
  onDetail: (operation: RuntimeOperation, id: string) => void;
  onMutation: (
    operation: RuntimeOperation,
    body: string,
  ) => Promise<MutationOutcome | void> | MutationOutcome | void;
  onDelete: (
    operation: RuntimeOperation,
    id: string,
    confirmed?: boolean,
  ) => Promise<MutationOutcome | void> | MutationOutcome | void;
};

function OperationOverlay({
  open,
  mode,
  title,
  subtitle,
  danger = false,
  onClose,
  children,
}: {
  open: boolean;
  mode: ResolvedInteraction[keyof ResolvedInteraction];
  title: string;
  subtitle?: string;
  danger?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      {subtitle && <p className="ant-operation-subtitle">{subtitle}</p>}
      {children}
    </>
  );
  if (mode === "drawer")
    return (
      <Drawer
        open={open}
        title={title}
        onClose={onClose}
        width={560}
        className={
          danger
            ? "generated-operation-drawer generated-operation-drawer--danger"
            : "generated-operation-drawer"
        }
      >
        {content}
      </Drawer>
    );
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      mask={{ closable: !danger }}
      keyboard={!danger}
      className={
        danger
          ? "generated-operation-modal generated-operation-modal--danger"
          : "generated-operation-modal"
      }
    >
      {content}
    </Modal>
  );
}

export function MutationPanel({
  page,
  zh,
  displayColumns,
  identityForRow,
  fieldErrors,
  submitting = false,
  fieldSchemas,
  interaction,
  createOperation,
  editOperation,
  deleteOperation,
  detailOperation,
  detail,
  localDetail,
  creating,
  editingRow,
  deletingRow,
  viewingRow,
  onCloseCreate,
  onCloseEdit,
  onCloseDelete,
  onCloseDetail,
  onRowsChange,
  onDetail,
  onMutation,
  onDelete,
}: Props) {
  const activeColumns = displayColumns ?? page.columns;
  const [createForm, setCreateForm] = useState("{\n  \n}");
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [createErrors, setCreateErrors] = useState<FieldErrors>({});
  const [editForm, setEditForm] = useState('{\n  "id": ""\n}');
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [errorMode, setErrorMode] = useState<"create" | "edit" | null>(null);
  const [deleteId, setDeleteId] = useState("");
  const [detailId, setDetailId] = useState("");
  useEffect(() => {
    setServerErrors(fieldErrors ?? {});
  }, [fieldErrors]);
  const operationFields = (operation?: RuntimeOperation) => {
    const id = operation?.operationId;
    if (!id) return [];
    const bindingFields = page.operations?.find(
      (binding) =>
        binding.operation_id === id &&
        (!operation.apiDocumentId || binding.apiDocumentId === operation.apiDocumentId),
    )?.bodySchema;
    return bindingFields?.length ? bindingFields : (fieldSchemas?.[id] ?? []);
  };
  const createFields = operationFields(createOperation);
  const editFields = operationFields(editOperation);
  const visibleCreateFields = visibleFieldSchemas(createFields, createValues);
  const visibleEditFields = visibleFieldSchemas(editFields, editValues);
  const rowRecord = (row: string[]) =>
    Object.fromEntries(activeColumns.map((column, index) => [column, row[index] || ""]));
  const rowId = (row: string[]) => identityForRow?.(row) || recordId(activeColumns, row);
  const deleteBinding = page.operations?.find(
    (binding) =>
      binding.operation_id === deleteOperation?.operationId &&
      (!deleteOperation.apiDocumentId || binding.apiDocumentId === deleteOperation.apiDocumentId),
  );

  useEffect(() => {
    if (!editingRow) return;
    const record = rowRecord(editingRow);
    setEditForm(JSON.stringify(record, null, 2));
    setEditValues(
      Object.fromEntries(editFields.map((field) => [field.name, String(record[field.name] ?? "")])),
    );
    setEditErrors({});
    setFormError("");
  }, [editingRow]);

  const setFieldError = (
    field: FieldSchema,
    value: string,
    setter: Dispatch<SetStateAction<FieldErrors>>,
  ) =>
    setter((current) => {
      const next = { ...current };
      const error = validateField(field, value, zh);
      if (error) next[field.name] = error;
      else delete next[field.name];
      return next;
    });

  const renderFields = (
    fields: FieldSchema[],
    values: Record<string, string>,
    setValues: Dispatch<SetStateAction<Record<string, string>>>,
    errors: FieldErrors,
    setErrors: Dispatch<SetStateAction<FieldErrors>>,
    mode: "create" | "edit",
  ) => {
    const allErrors = { ...(errorMode === mode ? serverErrors : {}), ...errors };
    return (
      <Form className="schema-fields" layout="vertical">
        {fields.map((field) => (
          <Form.Item
            className="modal-form-field"
            key={field.name}
            label={field.name}
            required={field.required}
            help={allErrors[field.name] || field.description}
            validateStatus={allErrors[field.name] ? "error" : undefined}
          >
            <FieldRenderer
              field={field}
              value={values[field.name] ?? ""}
              invalid={Boolean(allErrors[field.name])}
              onBlur={() => setFieldError(field, values[field.name] ?? "", setErrors)}
              onChange={(value) => {
                setValues((current) => ({ ...current, [field.name]: value }));
                if (serverErrors[field.name])
                  setServerErrors((current) => {
                    const next = { ...current };
                    delete next[field.name];
                    return next;
                  });
                if (errors[field.name]) setFieldError(field, value, setErrors);
              }}
            />
          </Form.Item>
        ))}
      </Form>
    );
  };

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

  /** A non-success outcome keeps the dialog open and all field values intact. */
  const runSubmit = async (
    task: () => Promise<MutationOutcome | void> | MutationOutcome | void,
    onSuccess: () => void,
    mode?: "create" | "edit",
  ) => {
    if (pending || submitting) return;
    setPending(true);
    if (mode) setErrorMode(mode);
    setFormError("");
    try {
      const outcome = await task();
      if (outcome === "success") {
        setServerErrors({});
        setErrorMode(null);
        onSuccess();
      } else if (outcome && outcome !== "skipped") {
        setFormError(
          zh
            ? "提交未成功，请检查字段错误后重试；输入已保留"
            : "Submission failed; review field errors and retry. Your input is kept.",
        );
      }
    } finally {
      setPending(false);
    }
  };

  const submitCreate = (closeAfter: boolean) => {
    if (!createOperation) return;
    const result = createFields.length
      ? serializeFieldValues(visibleCreateFields, createValues, zh)
      : { payload: rawPayload(createForm), errors: {} };
    setCreateErrors(result.errors);
    if (!result.payload) return;
    const payload = result.payload;
    void runSubmit(
      () => onMutation(createOperation, payload),
      () => {
        setCreateValues({});
        setCreateForm("{\n  \n}");
        setCreateErrors({});
        if (closeAfter) onCloseCreate();
      },
      "create",
    );
  };

  const submitEdit = (closeAfter: boolean) => {
    if (!editingRow) return;
    const result = editFields.length
      ? serializeFieldValues(visibleEditFields, editValues, zh)
      : { payload: rawPayload(editForm), errors: {} };
    setEditErrors(result.errors);
    if (!result.payload) return;
    const id = rowId(editingRow);
    if (editOperation && !id) {
      setFormError(
        zh
          ? "当前记录没有可用的 ID，无法提交编辑请求"
          : "The selected record has no usable ID for this update request",
      );
      return;
    }
    const payload = result.payload;
    void runSubmit(
      () => {
        if (editOperation)
          return onMutation(
            {
              ...editOperation,
              path: editOperation.path.replace(/\{[^}]+\}/, encodeURIComponent(id)),
            },
            payload,
          );
        const next = JSON.parse(payload) as Record<string, unknown>;
        onRowsChange((rows) =>
          rows.map((row) =>
            row === editingRow ? activeColumns.map((column) => String(next[column] ?? "")) : row,
          ),
        );
        return "success" as const;
      },
      () => {
        setEditErrors({});
        if (closeAfter) onCloseEdit();
      },
      "edit",
    );
  };

  const detailValues = viewingRow
    ? { ...rowRecord(viewingRow), ...(detail ?? {}) }
    : (detail ?? localDetail);
  const renderDetail = (values: Record<string, unknown> | null) =>
    values && (
      <dl className="detail-grid">
        {Object.entries(values).map(([key, value]) => (
          <Fragment key={key}>
            <dt>{key}</dt>
            <dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</dd>
          </Fragment>
        ))}
      </dl>
    );
  const renderDeletePreview = (row: string[]) => (
    <dl className="delete-preview">
      {activeColumns.slice(0, 4).map((column, index) => (
        <Fragment key={column}>
          <dt>{column}</dt>
          <dd>{row[index] || "-"}</dd>
        </Fragment>
      ))}
    </dl>
  );
  const editChanges =
    editingRow &&
    visibleEditFields
      .map((field) => ({
        name: field.name,
        before: rowRecord(editingRow)[field.name] ?? "",
        after: editValues[field.name] ?? "",
      }))
      .filter((change) => change.before !== change.after);

  const createContent = (
    <>
      {createFields.length ? (
        renderFields(
          visibleCreateFields,
          createValues,
          setCreateValues,
          createErrors,
          setCreateErrors,
          "create",
        )
      ) : (
        <Input.TextArea
          value={createForm}
          onChange={(event) => setCreateForm(event.target.value)}
          spellCheck={false}
          autoSize={{ minRows: 8 }}
        />
      )}
      {formError && <Alert className="form-error" type="error" showIcon message={formError} />}
      <Space className="modal-actions">
        <Button onClick={onCloseCreate}>{zh ? "取消" : "Cancel"}</Button>
        <Button
          type="primary"
          loading={pending || submitting}
          disabled={pending || submitting}
          onClick={() => submitCreate(true)}
        >
          {zh ? "提交" : "Submit"}
        </Button>
      </Space>
    </>
  );
  const editContent = editingRow && (
    <>
      {editFields.length ? (
        renderFields(
          visibleEditFields,
          editValues,
          setEditValues,
          editErrors,
          setEditErrors,
          "edit",
        )
      ) : (
        <Input.TextArea
          value={editForm}
          onChange={(event) => setEditForm(event.target.value)}
          spellCheck={false}
          autoSize={{ minRows: 8 }}
        />
      )}
      {editChanges && editChanges.length > 0 && (
        <div className="edit-change-preview">
          <span className="eyebrow">{zh ? "本次变更" : "CHANGES"}</span>
          {editChanges.map((change) => (
            <div key={change.name}>
              <strong>{change.name}</strong>
              <span>{change.before || "-"}</span>
              <span aria-hidden="true">→</span>
              <span>{change.after || "-"}</span>
            </div>
          ))}
        </div>
      )}
      {formError && <Alert className="form-error" type="error" showIcon message={formError} />}
      <Space className="modal-actions">
        <Button onClick={onCloseEdit}>{zh ? "取消" : "Cancel"}</Button>
        <Button
          type="primary"
          loading={pending || submitting}
          disabled={pending || submitting}
          onClick={() => submitEdit(true)}
        >
          {zh ? "保存编辑" : "Save changes"}
        </Button>
      </Space>
    </>
  );

  return (
    <>
      {createOperation && interaction.create === "inline" && (
        <div className="mutation-box">
          <span className="eyebrow">CREATE FORM · USER ACTION REQUIRED</span>
          <h4>{zh ? "新增记录" : "Create record"}</h4>
          {createFields.length ? (
            renderFields(
              visibleCreateFields,
              createValues,
              setCreateValues,
              createErrors,
              setCreateErrors,
              "create",
            )
          ) : (
            <Input.TextArea
              value={createForm}
              onChange={(event) => setCreateForm(event.target.value)}
              spellCheck={false}
              aria-label={zh ? "新增记录 JSON" : "Create record JSON"}
              autoSize={{ minRows: 4 }}
            />
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <Button
            type="primary"
            loading={pending || submitting}
            disabled={pending || submitting}
            onClick={() => submitCreate(false)}
          >
            {zh ? "提交新增" : "Create"}
          </Button>
        </div>
      )}
      {createOperation && creating && usesRedirect(interaction.create) && (
        <div className="redirect-operation-surface">
          <h4>{zh ? "新增记录" : "Create record"}</h4>
          {createContent}
        </div>
      )}
      {editingRow && !usesOverlay(interaction.update) && (
        <div
          className={
            usesRedirect(interaction.update) ? "redirect-operation-surface" : "mutation-box"
          }
        >
          <h4>{zh ? "编辑记录" : "Edit record"}</h4>
          {editContent}
        </div>
      )}
      {detailOperation && interaction.detail === "inline" && (
        <div className="mutation-box">
          <span className="eyebrow">DETAIL PANEL</span>
          <h4>{zh ? "查看详情" : "View details"}</h4>
          <div className="delete-row">
            <Input
              placeholder={zh ? "记录 ID" : "Record ID"}
              aria-label={zh ? "记录 ID" : "Record ID"}
              value={detailId}
              onChange={(event) => setDetailId(event.target.value)}
            />
            <Button onClick={() => onDetail(detailOperation, detailId)}>
              {zh ? "加载详情" : "Load details"}
            </Button>
          </div>
          {renderDetail(detail ?? localDetail)}
        </div>
      )}
      {detailOperation && viewingRow && usesRedirect(interaction.detail) && (
        <div className="redirect-operation-surface">
          <h4>{zh ? "记录详情" : "Record details"}</h4>
          {renderDetail(detailValues)}
        </div>
      )}
      {!detailOperation && localDetail && interaction.detail === "inline" && (
        <div className="local-detail">{renderDetail(localDetail)}</div>
      )}
      {!detailOperation && viewingRow && usesRedirect(interaction.detail) && (
        <div className="redirect-operation-surface">
          <h4>{zh ? "记录详情" : "Record details"}</h4>
          {renderDetail(detailValues)}
        </div>
      )}
      {deleteOperation && interaction.delete === "inline" && (
        <div className="mutation-box">
          <span className="eyebrow">DELETE · CONFIRMATION REQUIRED</span>
          <h4>{zh ? "删除记录" : "Delete record"}</h4>
          {deletingRow ? (
            <>
              {renderDeletePreview(deletingRow)}
              <p className="modal-intro">
                {deleteBinding?.confirmMessage ??
                  (zh
                    ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。`
                    : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}
              </p>
              <Space className="modal-actions">
                <Button onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</Button>
                <Button
                  danger
                  type="primary"
                  loading={pending || submitting}
                  disabled={pending || submitting}
                  onClick={() =>
                    void runSubmit(
                      () => onDelete(deleteOperation, rowId(deletingRow), true),
                      onCloseDelete,
                    )
                  }
                >
                  {zh ? "确认删除" : "Delete"}
                </Button>
              </Space>
            </>
          ) : (
            <div className="delete-row">
              <Input
                placeholder={zh ? "记录 ID" : "Record ID"}
                aria-label={zh ? "记录 ID" : "Record ID"}
                value={deleteId}
                onChange={(event) => setDeleteId(event.target.value)}
              />
              <Button
                danger
                loading={pending || submitting}
                disabled={pending || submitting}
                onClick={() =>
                  void runSubmit(
                    () => onDelete(deleteOperation, deleteId),
                    () => setDeleteId(""),
                  )
                }
              >
                {zh ? "删除" : "Delete"}
              </Button>
            </div>
          )}
        </div>
      )}
      {deleteOperation && deletingRow && usesRedirect(interaction.delete) && (
        <div className="redirect-operation-surface">
          <h4>{zh ? "确认删除" : "Confirm deletion"}</h4>
          {renderDeletePreview(deletingRow)}
          <p className="modal-intro">
            {deleteBinding?.confirmMessage ??
              (zh
                ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。`
                : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}
          </p>
          <Space className="modal-actions">
            <Button onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</Button>
            <Button
              danger
              type="primary"
              loading={pending || submitting}
              disabled={pending || submitting}
              onClick={() =>
                void runSubmit(
                  () => onDelete(deleteOperation, rowId(deletingRow), true),
                  onCloseDelete,
                )
              }
            >
              {zh ? "确认删除" : "Delete"}
            </Button>
          </Space>
        </div>
      )}

      <OperationOverlay
        open={Boolean(creating && createOperation && usesOverlay(interaction.create))}
        mode={interaction.create}
        onClose={onCloseCreate}
        title={`${page.title} · ${zh ? "新增" : "Create"}`}
        subtitle={zh ? "填写信息后提交新增记录" : "Complete the fields to create a record"}
      >
        {createContent}
      </OperationOverlay>
      <OperationOverlay
        open={Boolean(editingRow && usesOverlay(interaction.update))}
        mode={interaction.update}
        onClose={onCloseEdit}
        title={zh ? "编辑记录" : "Edit record"}
        subtitle={editingRow ? `${page.title} · ${rowId(editingRow)}` : page.title}
      >
        {editContent}
      </OperationOverlay>
      <OperationOverlay
        open={Boolean(viewingRow && usesOverlay(interaction.detail))}
        mode={interaction.detail}
        onClose={onCloseDetail}
        title={zh ? "记录详情" : "Record details"}
        subtitle={viewingRow ? `${page.title} · ${rowId(viewingRow)}` : page.title}
      >
        {renderDetail(detailValues)}
      </OperationOverlay>
      <OperationOverlay
        open={Boolean(deletingRow && deleteOperation && usesOverlay(interaction.delete))}
        mode={interaction.delete}
        onClose={onCloseDelete}
        title={zh ? "确认删除" : "Confirm deletion"}
        subtitle="DELETE · CONFIRMATION"
        danger
      >
        {deletingRow && (
          <>
            {renderDeletePreview(deletingRow)}
            <p className="modal-intro">
              {deleteBinding?.confirmMessage ??
                (zh
                  ? `确定删除记录 ${rowId(deletingRow)} 吗？此操作不可撤销。`
                  : `Delete record ${rowId(deletingRow)}? This cannot be undone.`)}
            </p>
            <Space className="modal-actions">
              <Button onClick={onCloseDelete}>{zh ? "取消" : "Cancel"}</Button>
              <Button
                danger
                type="primary"
                loading={pending || submitting}
                disabled={pending || submitting}
                onClick={() =>
                  void runSubmit(
                    () =>
                      deleteOperation
                        ? onDelete(deleteOperation, rowId(deletingRow), true)
                        : ("skipped" as const),
                    onCloseDelete,
                  )
                }
              >
                {zh ? "确认删除" : "Delete"}
              </Button>
            </Space>
          </>
        )}
      </OperationOverlay>
    </>
  );
}
