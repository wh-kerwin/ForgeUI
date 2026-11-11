import { type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneratedWorkbenchView } from "../../src/features/workbench/GeneratedWorkbenchView";
import { PageRefineBox } from "../../src/features/pages/PageRefineBox";
import { PageDefinitionDiff } from "../../src/features/pages/PageDefinitionDiff";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import type { PageSpec } from "../../src/types/domain";
import { createPageRuntimeState } from "../../src/features/pages/runtime/pageRuntimeState";
import { diffPageDefinitions } from "../../src/features/pages/pageRefinement";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

const uiTest = (name: string, body: () => Promise<void> | void) => it(name, body, 60_000);

function page(): PageSpec {
  return {
    title: "Orders",
    description: "D2 fixture",
    filters: ["keyword"],
    stats: [],
    columns: ["id", "amount"],
    columnMeta: [{ name: "amount", type: "money", format: "number" }],
    rows: [],
  };
}

function modifiedPage(change: (next: PageSpec) => void): PageSpec {
  const next = page();
  change(next);
  return next;
}

const diffs = {
  money: diffPageDefinitions(
    page(),
    modifiedPage((next) => {
      next.columnMeta![0].format = "currency:CNY";
    }),
  ),
  hidden: diffPageDefinitions(
    page(),
    modifiedPage((next) => {
      next.columnMeta![0].visible = false;
    }),
  ),
  filter: diffPageDefinitions(
    page(),
    modifiedPage((next) => {
      next.filters = ["keyword", "owner"];
    }),
  ),
};

function refineProps(
  overrides: Partial<ComponentProps<typeof GeneratedWorkbenchView>["refine"]> = {},
): ComponentProps<typeof GeneratedWorkbenchView>["refine"] {
  return {
    status: "idle",
    diff: null,
    issues: [],
    canUndo: false,
    onRefine: vi.fn(async () => true),
    onApply: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    ...overrides,
  };
}

function hostProps(
  refine: ComponentProps<typeof GeneratedWorkbenchView>["refine"],
): ComponentProps<typeof GeneratedWorkbenchView> {
  return {
    page: page(),
    projectId: "p1",
    apiDocumentIds: ["doc-1"],
    isStreaming: false,
    operations: [],
    detail: null,
    onDetail: vi.fn(),
    onSaved: vi.fn(),
    onQuery: vi.fn(),
    onMutation: vi.fn(),
    onDelete: vi.fn(),
    querying: false,
    queryMeta: { status: "success" },
    runtime: createPageRuntimeState("d2"),
    onSelectionKeysChange: vi.fn(),
    onRuntimeControls: vi.fn(),
    sessions: [],
    onOpenSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onInvalid: vi.fn(),
    refine,
  };
}

function renderPanel(refine: ComponentProps<typeof GeneratedWorkbenchView>["refine"]) {
  return render(
    <>
      <PageRefineBox
        onRefine={refine.onRefine}
        status={refine.status}
        issues={refine.issues}
        canUndo={refine.canUndo}
        onUndo={refine.onUndo}
      />
      {refine.status === "previewDiff" && refine.diff && (
        <PageDefinitionDiff
          diff={refine.diff}
          zh
          applying={false}
          onApply={refine.onApply}
          onDiscard={refine.onDiscard}
        />
      )}
    </>,
    { wrapper: LanguageProvider },
  );
}

describe("D2 reviewed page refinement", () => {
  uiTest("the real host exposes the refinement entry point", () => {
    const refine = refineProps();
    render(<GeneratedWorkbenchView {...hostProps(refine)} />, { wrapper: LanguageProvider });
    const input = screen.getByRole("textbox", { name: "修改指令" });
    fireEvent.change(input, { target: { value: "把金额改为货币格式" } });
    fireEvent.click(screen.getByRole("button", { name: "预览修改" }));
    expect(refine.onRefine).toHaveBeenCalledWith("把金额改为货币格式");
  });

  uiTest("money formatting, hiding a column and adding a filter are reviewable diffs", () => {
    for (const [name, diff] of Object.entries(diffs)) {
      const view = renderPanel(refineProps({ status: "previewDiff", diff }));
      const container = view.container.querySelector(".refine-diff") as HTMLElement;
      expect(container).toBeTruthy();
      if (name === "filter") {
        expect(container.dataset.requery).toBe("true");
        expect(screen.getByText(/清空当前数据/)).toBeTruthy();
      } else {
        expect(container.dataset.requery).toBe("false");
        expect(container.querySelector('[data-diff-category="field"]')).not.toBeNull();
      }
      view.unmount();
    }
  });

  uiTest("apply, discard and undo are explicit user actions", () => {
    const refine = refineProps({
      status: "previewDiff",
      diff: diffs.money,
      canUndo: true,
    });
    renderPanel(refine);
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(refine.onApply).toHaveBeenCalledTimes(1);
    expect(refine.onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "撤销上次修改" })).toBeNull();

    const undoable = refineProps({ status: "idle", canUndo: true });
    renderPanel(undoable);
    fireEvent.click(screen.getByRole("button", { name: "撤销上次修改" }));
    expect(undoable.onUndo).toHaveBeenCalledTimes(1);
  });

  uiTest("an unauthorized new operation is shown and the instruction is kept", async () => {
    const onRefine = vi.fn(async () => false);
    const view = renderPanel(refineProps({ onRefine }));
    const input = screen.getByRole("textbox", { name: "修改指令" });
    fireEvent.change(input, { target: { value: "新增删除按钮" } });
    fireEvent.click(screen.getByRole("button", { name: "预览修改" }));
    await Promise.resolve();
    expect(onRefine).toHaveBeenCalledWith("新增删除按钮");
    view.rerender(
      <>
        <PageRefineBox
          onRefine={onRefine}
          status="error"
          issues={[
            { code: "REFINE_OPERATION_UNAUTHORIZED", message: "候选页面包含未授权的新操作" },
          ]}
          canUndo={false}
          onUndo={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText("候选页面包含未授权的新操作")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "修改指令" }) as HTMLInputElement).value).toBe(
      "新增删除按钮",
    );
  });

  uiTest("a project switch removes the pending preview and the undo action", () => {
    const view = renderPanel(
      refineProps({ status: "previewDiff", diff: diffs.filter, canUndo: true }),
    );
    expect(view.container.querySelector(".refine-diff")).not.toBeNull();
    view.rerender(
      <>
        <PageRefineBox
          onRefine={vi.fn(async () => true)}
          status="idle"
          issues={[]}
          canUndo={false}
          onUndo={vi.fn()}
        />
      </>,
    );
    expect(view.container.querySelector(".refine-diff")).toBeNull();
    expect(screen.queryByRole("button", { name: "撤销上次修改" })).toBeNull();
  });
});
