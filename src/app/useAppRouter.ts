import { useEffect, useState } from "react";
import { parseRoute, routePath, type AppRoute } from "./routes";

export function useAppRouter() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute());
  useEffect(() => { const onPop = () => setRoute(parseRoute()); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  const navigate = (next: AppRoute) => { if (next === route) return; window.history.pushState({}, "", routePath(next)); setRoute(next); };
  return { route, navigate };
}
