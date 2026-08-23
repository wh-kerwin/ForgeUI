import React from "react";
import { createRoot } from "react-dom/client";
import { Workbench } from "./features/workbench/Workbench";
import { LanguageProvider } from "./i18n/LanguageProvider";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider><Workbench /></LanguageProvider>
  </React.StrictMode>,
);
