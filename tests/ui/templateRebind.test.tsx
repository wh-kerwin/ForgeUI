import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import {
  TemplateLibrary,
  type TemplateBindingProps,
} from "../../src/features/templates/TemplateLibrary";
import { TemplateBindingPanel } from "../../src/features/templates/TemplateBindingPanel";
import {
  reconcileTemplateBindings,
  type BindingReconciliation,
} from "../../src/features/templates/templateBinding";
import { operationKey } from "../../src/features/pages/pageOperations";
import type { ApiDocument, PageSpec, TemplateRecord } from "../../src/types/domain";

const LIST_KEY = operationKey("GET", "/orders", "listOrders");

const uiTest = (name: string, body: () => Promise<void> | void) => it(name, body, 60_000);

function page(): PageSpec {
  return {
    title: "Orders",
    description: "",
    filters: [],
    stats: [],
    columns: ["id"],
    rows: [],
    operations: [{ operation_id: "listOrders", method: "GET", path: "/orders", role: "list" }],
  };
}

function template(id: string, apiDocumentIds: string[]): TemplateRecord {
  return {
    id,
    projectId: "p1",
    name: `Template ${id}`,
    payload: JSON.stringify(page()),
    version: 1,
    updatedAt: "",
    apiDocumentIds,
  };
}

function document(id: string, operations: string[] = [LIST_KEY]): ApiDocument {
  return {
    id,
    projectId: "p1",
    name: `Document ${id}`,
    enabled: true,
    spec: {
      title: "",
      version: "",
      spec_version: "",
      operation_count: operations.length,
      operations,
      api_base_url: "",
      discovered_url: "",
    },
    auth: { type: "", secretRef: "", apiKeyName: "", caPem: "" },
    createdAt: "",
    updatedAt: "",
  };
}

function emptyBinding(): TemplateBindingProps {
  return {
    request: null,
    selections: {},
    onSelect: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
}

function libraryProps(overrides: Partial<Parameters<typeof TemplateLibrary>[0]> = {}) {
  return {
    templates: [template("t1", ["doc-1"]), template("t2", ["missing"])],
    versions: [],
    selectedTemplateId: "",
    documents: [document("doc-1")],
    projectId: "p1",
    binding: emptyBinding(),
    onUse: vi.fn(),
    onShowVersions: vi.fn(),
    onRestore: vi.fn(),
    onInvalidTemplate: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  };
}

function reconciliation(sourceIds: string[], documents: ApiDocument[]): BindingReconciliation {
  return reconcileTemplateBindings({
    template: template("t1", sourceIds),
    page: page(),
    documents,
    projectId: "p1",
  });
}

describe("D3 template binding reconciliation", () => {
  uiTest("the template list shows binding status and routes use through the host", () => {
    const onUse = vi.fn();
    const props = libraryProps({ onUse });
    const view = render(<TemplateLibrary {...props} />, { wrapper: LanguageProvider });
    expect(screen.getByText("绑定有效")).toBeTruthy();
    expect(screen.getByText("需确认重绑定")).toBeTruthy();
    expect(view.container.querySelectorAll("[data-binding-summary]").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Template t1/ }));
    expect(onUse).toHaveBeenCalledTimes(1);
    const [record, parsed] = onUse.mock.calls[0];
    expect(record.id).toBe("t1");
    expect(parsed.title).toBe("Orders");
  });

  uiTest("a template with no candidate cannot be confirmed", () => {
    const result = reconciliation(["doc-1"], []);
    const onConfirm = vi.fn();
    render(
      <TemplateBindingPanel
        title="Orders"
        reconciliation={result}
        selections={{}}
        zh
        onSelect={vi.fn()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
      { wrapper: LanguageProvider },
    );
    expect(screen.getByText(/没有匹配的方法\+路径\+操作/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "确认绑定并使用" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  uiTest("an ambiguous binding needs an explicit choice and acknowledgement", () => {
    const result = reconciliation(["doc-1"], [document("doc-1"), document("doc-2")]);
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    render(
      <TemplateBindingPanel
        title="Orders"
        reconciliation={result}
        selections={{}}
        zh
        onSelect={onSelect}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
      { wrapper: LanguageProvider },
    );
    const select = screen.getByLabelText(`绑定 ${LIST_KEY}`);
    expect((select as HTMLSelectElement).options.length).toBe(3);
    const confirm = screen.getByRole("button", { name: "确认绑定并使用" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(select, { target: { value: "doc-2" } });
    expect(onSelect).toHaveBeenCalledWith(LIST_KEY, "doc-2");
    expect(confirm.disabled).toBe(true);
  });

  uiTest("selection plus acknowledgement enables confirmation", () => {
    const result = reconciliation(["doc-1"], [document("doc-1"), document("doc-2")]);
    const onConfirm = vi.fn();
    render(
      <TemplateBindingPanel
        title="Orders"
        reconciliation={result}
        selections={{ [LIST_KEY]: "doc-2" }}
        zh
        onSelect={vi.fn()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
      { wrapper: LanguageProvider },
    );
    const confirm = screen.getByRole("button", { name: "确认绑定并使用" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  uiTest("a same-name operation on a different path is labelled, not substituted", () => {
    const result = reconciliation(["doc-1"], [document("doc-2", ["GET /v2/orders · listOrders"])]);
    render(
      <TemplateBindingPanel
        title="Orders"
        reconciliation={result}
        selections={{}}
        zh
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: LanguageProvider },
    );
    expect(screen.getByText("仅同名操作，路径不同")).toBeTruthy();
    expect(screen.getByText(/跨项目文档 ID 不会沿用/)).toBeTruthy();
  });
});
