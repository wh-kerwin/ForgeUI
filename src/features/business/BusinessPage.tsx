import type { SetStateAction } from "react";
import type { BusinessAuth, OpenApiSummary } from "../../types/domain";
import { useLanguage } from "../../i18n/LanguageProvider";
import { PageLayout } from "../openapi/OpenApiPage";
import { SelectField } from "../../components/SelectField";
import { GrantedRolesField } from "../../components/GrantedRolesField";

type Props = { spec: OpenApiSummary | null; auth: BusinessAuth; secret: string; onAuthChange: (value: SetStateAction<BusinessAuth>) => void; onSecretChange: (value: string) => void; onSave: () => void };

export function BusinessPage({ spec, auth, secret, onAuthChange, onSecretChange, onSave }: Props) {
  const { language } = useLanguage();
  const zh = language === "zh";
  return <PageLayout eyebrow="BUSINESS CONNECTION" title={zh ? "业务连接" : "Business connection"} intro={zh ? "配置业务 API 基址、认证凭证和企业 CA。凭证只保存在系统钥匙串。" : "Configure the business API, credentials and enterprise CA. Credentials stay in the system keychain."}>
    <section className="panel route-panel auth-box">
      <span className="eyebrow">UPSTREAM AUTH</span>
      <input type="url" placeholder={zh ? "业务 API 基址，例如 https://api.example.com/v1" : "Business API base URL, e.g. https://api.example.com/v1"} value={auth.apiBaseUrl || spec?.api_base_url || ""} onChange={(event) => onAuthChange((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
      <SelectField value={auth.type} options={[{ value: "none", label: zh ? "无认证" : "No authentication" }, { value: "bearer", label: "Bearer Token" }, { value: "apiKey", label: "API Key" }]} onChange={(value) => onAuthChange((current) => ({ ...current, type: value as BusinessAuth["type"] }))} ariaLabel={zh ? "认证方式" : "Authentication method"} />
      {auth.type === "apiKey" && <input placeholder={zh ? "Header 名称" : "Header name"} value={auth.apiKeyName} onChange={(event) => onAuthChange((current) => ({ ...current, apiKeyName: event.target.value }))} />}
      <GrantedRolesField roles={auth.grantedRoles ?? []} onChange={(roles) => onAuthChange((current) => ({ ...current, grantedRoles: roles }))} label={zh ? "当前用户角色" : "Current user roles"} placeholder={zh ? "例如：admin, operator" : "e.g. admin, operator"} help={zh ? "用于生成页面的前端可见性控制；业务接口仍以服务端鉴权为准。" : "Controls generated-page visibility. The business API remains authoritative for access."} />
      {auth.type !== "none" && <><input type="password" placeholder={zh ? "凭证（保存到系统钥匙串）" : "Credential (stored in the system keychain)"} value={secret} onChange={(event) => onSecretChange(event.target.value)} /><button className="primary" onClick={onSave}>{zh ? "保存凭证" : "Save credential"}</button></>}
      <textarea className="ca-input" placeholder={zh ? "可选：粘贴企业 CA PEM（不会关闭 TLS 校验）" : "Optional: paste enterprise CA PEM (TLS verification stays enabled)"} value={auth.caPem} onChange={(event) => onAuthChange((current) => ({ ...current, caPem: event.target.value }))} />
      <button className="secondary" onClick={onSave}>{zh ? "保存业务连接" : "Save business connection"}</button>
    </section>
  </PageLayout>;
}
