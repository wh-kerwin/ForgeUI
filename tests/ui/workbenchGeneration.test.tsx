import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Workbench } from "../../src/features/workbench/Workbench";
import { LanguageProvider } from "../../src/i18n/LanguageProvider";
import { useWorkbenchStore } from "../../src/store/workbenchStore";
import type { PageSpec } from "../../src/types/domain";

// Keep Workbench, workspace, persistence, generated actions and the rendered UI real.
// Only the desktop IPC/event boundaries are replaced with controllable promises.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const page = (title: string): PageSpec => ({
  title,
  description: "",
  filters: [],
  stats: [],
  columns: ["id"],
  rows: [],
  operations: [
    {
      operation_id: "listOrders",
      method: "GET",
      path: "/orders",
      role: "list",
      apiDocumentId: "doc",
    },
  ],
});
const result = (title: string, generationSource = "model") => ({
  page: page(title),
  generationSource,
  issues: [],
});
const invalid = {
  retryable: true,
  issues: [
    {
      code: "schema.invalid",
      path: "$",
      severity: "error",
      stage: "schema",
      message: "页面结构不符合 v1 契约",
    },
  ],
};

type Response = { status: number; body: unknown };
function fixture() {
  const generations: ReturnType<typeof deferred<ReturnType<typeof result>>>[] = [];
  const saves: ReturnType<typeof deferred<void>>[] = [];
  const queries: ReturnType<typeof deferred<Response>>[] = [];
  const listeners: {
    ready: ReturnType<typeof deferred<() => void>>;
    unlisten: ReturnType<typeof vi.fn<() => void>>;
    emit: (event: { payload: { requestId: string; delta: string } }) => void;
  }[] = [];
  vi.mocked(listen).mockImplementation((_name, handler) => {
    const ready = deferred<() => void>();
    const unlisten = vi.fn<() => void>();
    listeners.push({ ready, unlisten, emit: handler as (typeof listeners)[number]["emit"] });
    return ready.promise;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    switch (command) {
      case "list_projects":
        return ["a", "b"].map((id) => ({
          id,
          name: `Project ${id}`,
          selectedApiDocumentIds: ["doc"],
        }));
      case "list_api_documents":
        return [
          {
            id: "doc",
            projectId: args && "projectId" in args ? args.projectId : undefined,
            name: "Orders API",
            enabled: true,
            payload: {
              auth: {
                type: "none",
                apiBaseUrl: "http://localhost",
                authorizedOperations: ["GET /orders · listOrders"],
              },
              spec: {
                title: "Orders",
                operation_count: 1,
                operations: ["GET /orders · listOrders"],
                fieldSchemas: {},
              },
            },
          },
        ];
      case "load_templates":
      case "load_generation_sessions":
        return [];
      case "generate_page_detailed":
      case "generate_page_stream_detailed": {
        const request = deferred<ReturnType<typeof result>>();
        generations.push(request);
        return request.promise;
      }
      case "save_generation_session": {
        const request = deferred<void>();
        saves.push(request);
        return request.promise;
      }
      case "execute_api": {
        const request = deferred<Response>();
        queries.push(request);
        return request.promise;
      }
      case "cancel_query":
        return 1;
      default:
        throw new Error(`Unexpected IPC: ${command}`);
    }
  });
  return { generations, saves, queries, listeners };
}
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  window.history.replaceState({}, "", "/generate");
  window.localStorage.setItem(
    "forge-ui-prompt-templates",
    JSON.stringify([{ id: "query", name: "查询", scene: "query", systemPrompt: "" }]),
  );
  window.localStorage.setItem(
    "forge-models",
    JSON.stringify([
      {
        id: "model",
        name: "Test model",
        protocol: "openai",
        baseUrl: "http://model.invalid",
        model: "test",
        apiKey: "test-key",
        streaming: true,
        enabled: true,
        promptTemplateId: "query",
      },
    ]),
  );
  useWorkbenchStore.getState().setExecutionMode("live");
  useWorkbenchStore.getState().setPage(null);
});
async function mount() {
  const user = userEvent.setup();
  render(<Workbench />, { wrapper: LanguageProvider });
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /Orders API/ })).toBeTruthy());
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "订单列表" } });
  return user;
}
async function start(user: ReturnType<typeof userEvent.setup>, f: ReturnType<typeof fixture>) {
  const count = f.listeners.length;
  await user.click(screen.getByRole("button", { name: "生成页面" }));
  await waitFor(() => expect(f.listeners).toHaveLength(count + 1));
  return f.listeners[count];
}
async function switchProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "选择项目" }));
  await user.click(screen.getByRole("option", { name: "Project b" }));
  await waitFor(() => expect(useWorkbenchStore.getState().apiContext?.projectId).toBe("b"));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /Orders API/ })).toBeTruthy());
}
async function commit(f: ReturnType<typeof fixture>, index: number, title: string) {
  await act(async () => {
    f.listeners[index].ready.resolve(f.listeners[index].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(index + 1));
  await act(async () => {
    f.generations[index].resolve(result(title));
  });
  await waitFor(() => expect(f.saves).toHaveLength(index + 1));
  await act(async () => {
    f.saves[index].resolve();
  });
  await waitFor(() => expect(f.queries).toHaveLength(index + 1));
}

it("shows repaired provenance and safe diagnostics without exposing raw provider errors", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await commit(f, 0, "Valid previous page");
  await act(async () => {
    f.queries[0].resolve({ status: 200, body: [] });
  });
  await start(user, f);
  await act(async () => {
    f.listeners[1].ready.resolve(f.listeners[1].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  await act(async () => {
    f.generations[1].reject(new Error("SECRET raw body prompt rows"));
  });
  expect(screen.queryByText(/SECRET/)).toBeNull();
  expect(screen.getByRole("heading", { name: "Valid previous page" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy();
});

it("shows safe prompt-budget diagnostics from the generation request", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await act(async () => {
    f.listeners[0].ready.resolve(f.listeners[0].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  const request = vi
    .mocked(invoke)
    .mock.calls.find(([name]) => name === "generate_page_stream_detailed")?.[1] as {
    input: { prompt_diagnostics?: { code: string; message: string }[] };
  };
  request.input.prompt_diagnostics = [
    {
      code: "prompt_budget",
      message:
        "已按请求资源优先级保留 1 个完整授权操作，另有 2 个因预算省略；未省略项保留 apiDocumentId。",
    },
  ];
  await act(async () => {
    f.generations[0].resolve(result("Budget-aware page"));
  });
  await waitFor(() => expect(f.saves).toHaveLength(1));
  await act(async () => {
    f.saves[0].resolve();
  });
  await waitFor(() => expect(screen.getByText(/另有 2 个因预算省略/)).toBeTruthy());
  expect(screen.getAllByText(/另有 2 个因预算省略/)).toHaveLength(1);
  expect(f.generations).toHaveLength(1);
});

it("retries once without streaming and labels retry provenance", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await act(async () => {
    f.listeners[0].ready.resolve(f.listeners[0].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await act(async () => {
    f.generations[0].reject(invalid);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  expect(screen.getByText(/结构化重试/)).toBeTruthy();
  await act(async () => {
    f.generations[1].resolve(result("Retry page", "repaired"));
  });
  await waitFor(() => expect(f.saves).toHaveLength(1));
  await act(async () => {
    f.saves[0].resolve();
  });
  await waitFor(() => expect(screen.getByText(/来源：重试/)).toBeTruthy());
  expect(
    vi.mocked(invoke).mock.calls.filter(([name]) => name === "generate_page_detailed"),
  ).toHaveLength(1);
  const retry = vi.mocked(invoke).mock.calls.find(([name]) => name === "generate_page_detailed");
  expect((retry?.[1] as { input: { streaming: boolean } }).input.streaming).toBe(false);
});

it("labels safe repair separately from model success", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await act(async () => {
    f.listeners[0].ready.resolve(f.listeners[0].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await act(async () => {
    f.generations[0].resolve(result("Safely decoded", "repaired"));
  });
  await waitFor(() => expect(f.saves).toHaveLength(1));
  await act(async () => {
    f.saves[0].resolve();
  });
  await waitFor(() => expect(screen.getByText("来源：安全格式修复")).toBeTruthy());
});

it("uses an identifiable API fallback only after the one failed retry", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await act(async () => {
    f.listeners[0].ready.resolve(f.listeners[0].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await act(async () => {
    f.generations[0].reject(invalid);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  await act(async () => {
    f.generations[1].reject(invalid);
  });
  await waitFor(() => expect(f.saves).toHaveLength(1));
  await act(async () => {
    f.saves[0].resolve();
  });
  await waitFor(() => expect(screen.getByText("来源：API 基础页面（非模型输出）")).toBeTruthy());
  expect(f.generations).toHaveLength(2);
  expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy();
});

it("does not commit an invalid final result over the previous page", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await commit(f, 0, "Previous valid");
  await act(async () => {
    f.queries[0].resolve({ status: 200, body: [] });
  });
  await start(user, f);
  await act(async () => {
    f.listeners[1].ready.resolve(f.listeners[1].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  await act(async () => {
    f.generations[1].resolve({
      ...result("Invalid candidate"),
      page: { ...page("Invalid candidate"), version: 99 },
    });
  });
  expect(screen.getByRole("heading", { name: "Previous valid" })).toBeTruthy();
  expect(f.saves).toHaveLength(1);
  expect(screen.getByRole("button", { name: "重试生成" })).toBeTruthy();
});

it("generation hands auto-query loading ownership to the store when a user query replaces it", async () => {
  const f = fixture();
  const user = await mount();
  await start(user, f);
  await commit(f, 0, "Generated orders");
  expect(screen.getByRole("heading", { name: "Generated orders" })).toBeTruthy();
  // The prompt is usable after commit even though the initial query is still pending.
  expect((screen.getByRole("button", { name: "生成页面" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  let replacement!: Promise<void>;
  act(() => {
    replacement = useWorkbenchStore.getState().query(
      { keyword: "current" },
      {
        key: "GET /orders · listOrders",
        method: "GET",
        path: "/orders",
        operationId: "listOrders",
        apiDocumentId: "doc",
      },
    );
  });
  await waitFor(() => expect(f.queries).toHaveLength(2));
  await act(async () => {
    f.queries[0].resolve({ status: 200, body: [{ id: "stale" }] });
  });
  expect(useWorkbenchStore.getState().querying).toBe(true);
  expect(useWorkbenchStore.getState().loadingState).toBe("querying");
  expect(useWorkbenchStore.getState().page?.rows).toEqual([]);
  await act(async () => {
    f.queries[1].resolve({ status: 200, body: [{ id: "current" }] });
    await replacement;
  });
  expect(useWorkbenchStore.getState().page?.rows).toEqual([["current"]]);
  expect(useWorkbenchStore.getState().querying).toBe(false);
  expect(useWorkbenchStore.getState().loadingState).toBe("idle");
});

it("project switch during listen prevents old invoke and old finally cannot clear a new generation", async () => {
  const f = fixture();
  const user = await mount();
  const old = await start(user, f);
  await switchProject(user);
  const current = await start(user, f);
  await act(async () => {
    old.ready.resolve(old.unlisten);
  });
  expect(old.unlisten).toHaveBeenCalledTimes(1);
  expect(f.generations).toHaveLength(0);
  expect(useWorkbenchStore.getState().loadingState).toBe("generating");
  expect((screen.getByRole("button", { name: "生成中…" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => {
    current.ready.resolve(current.unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await act(async () => {
    f.generations[0].reject(new Error("current model failure"));
  });
  expect(useWorkbenchStore.getState().loadingState).toBe("idle");
  expect(screen.getByText(/模型请求未完成，请检查连接与授权配置后重试/)).toBeTruthy();
});

it("project switch during model generation ignores the old result and preserves the new generation", async () => {
  const f = fixture();
  const user = await mount();
  const old = await start(user, f);
  await act(async () => {
    old.ready.resolve(old.unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await switchProject(user);
  const current = await start(user, f);
  await act(async () => {
    f.generations[0].resolve(result("Obsolete model result"));
  });
  expect(f.saves).toHaveLength(0);
  expect(useWorkbenchStore.getState().page).toBeNull();
  expect(useWorkbenchStore.getState().loadingState).toBe("generating");
  expect(screen.queryByText("Obsolete model result")).toBeNull();
  await act(async () => {
    current.ready.resolve(current.unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  await act(async () => {
    f.generations[1].reject(new Error("new model failure"));
  });
  expect(useWorkbenchStore.getState().loadingState).toBe("idle");
  expect(screen.getByText(/模型请求未完成，请检查连接与授权配置后重试/)).toBeTruthy();
});

it("project switch while saving a session prevents stale commit and old finally preserves new querying", async () => {
  const f = fixture();
  const user = await mount();
  const old = await start(user, f);
  await act(async () => {
    old.ready.resolve(old.unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(1));
  await act(async () => {
    f.generations[0].resolve(result("Old project page"));
  });
  await waitFor(() => expect(f.saves).toHaveLength(1));
  await switchProject(user);
  await start(user, f);
  await act(async () => {
    f.listeners[1].ready.resolve(f.listeners[1].unlisten);
  });
  await waitFor(() => expect(f.generations).toHaveLength(2));
  await act(async () => {
    f.generations[1].resolve(result("Current project page"));
  });
  await waitFor(() => expect(f.saves).toHaveLength(2));
  await act(async () => {
    f.saves[1].resolve();
  });
  await waitFor(() => expect(f.queries).toHaveLength(1));
  await act(async () => {
    f.saves[0].resolve();
  });
  expect(useWorkbenchStore.getState().page?.title).toBe("Current project page");
  expect(useWorkbenchStore.getState().querying).toBe(true);
  expect(useWorkbenchStore.getState().loadingState).toBe("querying");
  expect(screen.queryByText("Old project page")).toBeNull();
  expect(f.queries).toHaveLength(1);
  await act(async () => {
    f.queries[0].resolve({ status: 200, body: [{ id: "b" }] });
  });
  expect(useWorkbenchStore.getState().page?.rows).toEqual([["b"]]);
  expect(useWorkbenchStore.getState().loadingState).toBe("idle");
});
