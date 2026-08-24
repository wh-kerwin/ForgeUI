import { DownloadCloud } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = { onNotice: (message: string) => void };

export function UpdateButton({ onNotice }: Props) {
  const { language } = useLanguage();
  const label = language === "zh" ? "检查更新" : "Updates";
  async function check() {
    try {
      const version = await invoke<string | null>("check_for_updates");
      if (!version) return onNotice("当前已是最新版本");
      if (!window.confirm(`发现 Forge UI ${version}，现在下载并安装？`)) return;
      await invoke<string | null>("install_update");
      onNotice("更新包已安装，应用将按安装器设置重启");
    } catch (error) {
      onNotice(`更新不可用：${String(error)}`);
    }
  }

  return <button className="update-button" aria-label={label} title={label} onClick={check}><DownloadCloud size={14} /><span>{label}</span></button>;
}
