export type AppRoute = "overview" | "generate" | "templates" | "business" | "openapi" | "models";

export function parseRoute(pathname = window.location.pathname): AppRoute {
  const value = pathname.replace(/^\/+|\/+$/g, "");
  return value === "generate" || value === "templates" || value === "business" || value === "openapi" || value === "models" ? value : "overview";
}

export function routePath(route: AppRoute) { return `/${route}`; }
