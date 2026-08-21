import React from "react";
import { createRoot } from "react-dom/client";
import { Workbench } from "./features/workbench/Workbench";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Workbench />
  </React.StrictMode>,
);
