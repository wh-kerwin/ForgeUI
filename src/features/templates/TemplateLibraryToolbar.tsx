import { Search, Upload } from "lucide-react";
import { useLanguage } from "../../i18n/LanguageProvider";

type Props = {
  query: string;
  count: number;
  total: number;
  onQueryChange: (value: string) => void;
  onImport: () => void;
};

export function TemplateLibraryToolbar({ query, count, total, onQueryChange, onImport }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return (
    <div className="template-toolbar">
      <label className="template-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={zh ? "搜索已保存页面" : "Search saved pages"}
          aria-label={zh ? "搜索已保存页面" : "Search saved pages"}
        />
      </label>
      <span className="template-count">
        {query ? `${count} / ${total}` : `${total} ${zh ? "个已保存" : "saved"}`}
      </span>
      <button className="version-btn" onClick={onImport}>
        <Upload size={14} /> {zh ? "导入" : "Import"}
      </button>
    </div>
  );
}
