import type { SetStateAction } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { PageLayout } from "../openapi/OpenApiPage";

type Props = { spec: OpenApiSummary | null; auth: BusinessAuth; secret: string; onAuthChange: (value: SetStateAction<BusinessAuth>) => void; onSecretChange: (value: string) => void; onSave: () => void };

export function BusinessPage({ spec, auth, secret, onAuthChange, onSecretChange, onSave }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return <PageLayout eyebrow="BUSINESS CONNECTION" title={zh ? "业务连接" : "Business connection"} intro={zh ? "配置业务 API 基址、认证凭证和企业 CA。凭证只保存在系统钥匙串。" : "Configure the business API, credentials and enterprise CA. Credentials stay in the system keychain."}>
    <section className="panel route-panel auth-box">
      <span className="eyebrow">UPSTREAM AUTH</span>
      <input type="url" placeholder={zh ? "业务 API 基址，例如 https://api.example.com/v1" : "Business API base URL, e.g. https://api.example.com/v1"} value={auth.apiBaseUrl || spec?.api_base_url || ""} onChange={(event) => onAuthChange((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
      <select value={auth.type} onChange={(event) => onAuthChange((current) => ({ ...current, type: event.target.value as BusinessAuth["type"] }))}>
        <option value="none">{zh ? "无认证" : "No authentication"}</option>
        <option value="bearer">Bearer Token</option>
        <option value="apiKey">API Key</option>
      </select>
      {auth.type === "apiKey" && <input placeholder={zh ? "Header 名称" : "Header name"} value={auth.apiKeyName} onChange={(event) => onAuthChange((current) => ({ ...current, apiKeyName: event.target.value }))} />}
      {auth.type !== "none" && <><input type="password" placeholder={zh ? "凭证（保存到系统钥匙串）" : "Credential (stored in the system keychain)"} value={secret} onChange={(event) => onSecretChange(event.target.value)} /><button className="primary" onClick={onSave}>{zh ? "保存凭证" : "Save credential"}</button></>}
      <textarea className="ca-input" placeholder={zh ? "可选：粘贴企业 CA PEM（不会关闭 TLS 校验）" : "Optional: paste enterprise CA PEM (TLS verification stays enabled)"} value={auth.caPem} onChange={(event) => onAuthChange((current) => ({ ...current, caPem: event.target.value }))} />
      <button className="secondary" onClick={onSave}>{zh ? "保存业务连接" : "Save business connection"}</button>
    </section>
  </PageLayout>;
}
