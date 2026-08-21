export type AppRoute = "generate" | "business" | "openapi" | "models";

export function parseRoute(pathname = window.location.pathname): AppRoute {
  const value = pathname.replace(/^\/+|\/+$/g, "");
  return value === "business" || value === "openapi" || value === "models" ? value : "generate";
}

export function routePath(route: AppRoute) { return `/${route}`; }
