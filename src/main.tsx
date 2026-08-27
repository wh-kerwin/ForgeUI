import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import { Workbench } from "./features/workbench/Workbench";
import { LanguageProvider } from "./i18n/LanguageProvider";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: "#d5fa61",
        colorInfo: "#d5fa61",
        colorBgBase: "#0b0e13",
        colorBgContainer: "#121923",
        colorBgElevated: "#171f2a",
        colorBorder: "#303b4b",
        colorText: "#e9edf5",
        colorTextSecondary: "#8491a3",
        colorError: "#ff7f86",
        borderRadius: 7,
        controlHeight: 34,
        fontFamily: "var(--font-ui)",
      },
    }}>
      <LanguageProvider><Workbench /></LanguageProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
