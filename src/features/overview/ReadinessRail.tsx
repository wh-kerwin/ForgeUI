import { AlertCircle, ArrowRight, CheckCircle2, Cpu, Database, Library } from "lucide-react";
import type { AppRoute } from "../../app/routes";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  modelReady: boolean;
  backendReady: boolean;
  templateCount: number;
  onNavigate: (route: AppRoute) => void;
};

function StatusIcon({ ready }: { ready: boolean }) {
  return ready ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />;
}

export function ReadinessRail({ modelReady, backendReady, templateCount, onNavigate }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const items = [
    {
      label: zh ? "AI 模型" : "AI model",
      value: modelReady
        ? zh
          ? "可以生成"
          : "Ready to generate"
        : zh
          ? "需要配置"
          : "Setup required",
      ready: modelReady,
      icon: <Cpu size={16} />,
      route: "models" as AppRoute,
    },
    {
      label: zh ? "业务 API" : "Business API",
      value: backendReady ? (zh ? "已连接" : "Connected") : zh ? "连接服务" : "Connect a service",
      ready: backendReady,
      icon: <Database size={16} />,
      route: "business" as AppRoute,
    },
    {
      label: zh ? "已保存页面" : "Saved pages",
      value: templateCount
        ? `${templateCount} ${zh ? "个可用" : "available"}`
        : zh
          ? "建立模板库"
          : "Build your library",
      ready: templateCount > 0,
      icon: <Library size={16} />,
      route: "templates" as AppRoute,
    },
  ];
  return (
    <section className="readiness-rail" aria-label={zh ? "工作台状态" : "Workspace readiness"}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`readiness-item ${item.ready ? "ready" : "needs-action"}`}
          onClick={() => onNavigate(item.route)}
        >
          <span className="readiness-icon">{item.icon}</span>
          <span className="readiness-copy">
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </span>
          <span className="readiness-state">
            <StatusIcon ready={item.ready} />
            <ArrowRight size={13} />
          </span>
        </button>
      ))}
    </section>
  );
}
