import { FolderKanban, Pencil, Plus, Trash2 } from "lucide-react";
import type { Project } from "../../types/domain";
import { SelectField } from "../../components/SelectField";

type Props = {
  projects: Project[];
  activeProjectId: string;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
};

export function ProjectSwitcher({ projects, activeProjectId, collapsed, onSelect, onCreate, onRename, onDelete }: Props) {
  if (collapsed) {
    return <button type="button" className="project-collapsed-button" aria-label="管理项目" title="管理项目" onClick={onCreate}><FolderKanban size={17} /></button>;
  }
  return <div className="project-switcher">
    <span className="eyebrow">PROJECT</span>
    <SelectField
      value={activeProjectId}
      options={projects.map((project) => ({ value: project.id, label: project.name }))}
      onChange={onSelect}
      ariaLabel="选择项目"
    />
    <div className="project-actions">
      <button type="button" className="icon-btn" aria-label="新建项目" title="新建项目" onClick={onCreate}><Plus size={15} /></button>
      <button type="button" className="icon-btn" aria-label="重命名项目" title="重命名项目" disabled={!activeProjectId} onClick={onRename}><Pencil size={15} /></button>
      <button type="button" className="icon-btn danger-icon" aria-label="删除项目" title="删除项目" disabled={!activeProjectId} onClick={onDelete}><Trash2 size={15} /></button>
    </div>
  </div>;
}
