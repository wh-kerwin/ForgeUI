import { useEffect, useId, useState } from "react";
import { parseGrantedRoles } from "../features/pages/pageRuntime";

export function GrantedRolesField({
  roles,
  onChange,
  label,
  placeholder,
  help,
}: {
  roles: string[];
  onChange: (roles: string[]) => void;
  label: string;
  placeholder: string;
  help: string;
}) {
  const helpId = useId();
  const [draft, setDraft] = useState(() => roles.join(", "));
  useEffect(() => setDraft(roles.join(", ")), [roles]);
  const commit = () => onChange(parseGrantedRoles(draft));
  return <label className="auth-field">
    <span>{label}</span>
    <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder={placeholder} aria-describedby={helpId} />
    <small id={helpId}>{help}</small>
  </label>;
}
