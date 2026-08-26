import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { getSelectMenuLayout, type SelectMenuViewport } from "./selectMenuPosition";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  invalid?: boolean;
  onBlur?: () => void;
};

export function SelectField({ value, options, onChange, ariaLabel, className = "", disabled = false, required = false, title, invalid = false, onBlur }: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  const readViewport = (): SelectMenuViewport => {
    const visualViewport = window.visualViewport;
    const fallbackWidth = document.documentElement.clientWidth || window.innerWidth;
    const fallbackHeight = document.documentElement.clientHeight || window.innerHeight;
    const visualViewportIsUsable = Boolean(visualViewport && visualViewport.width > 0 && visualViewport.height > 0);
    return {
      left: visualViewportIsUsable ? visualViewport!.offsetLeft : 0,
      top: visualViewportIsUsable ? visualViewport!.offsetTop : 0,
      width: visualViewportIsUsable ? visualViewport!.width : Math.max(1, fallbackWidth),
      height: visualViewportIsUsable ? visualViewport!.height : Math.max(1, fallbackHeight),
    };
  };

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const nextStyle = getSelectMenuLayout({
      trigger: rect,
      viewport: readViewport(),
      optionCount: options.length,
      measuredHeight: menuRef.current?.scrollHeight ?? 0,
    });
    setMenuStyle((current) => current
      && current.top === nextStyle.top
      && current.left === nextStyle.left
      && current.width === nextStyle.width
      && current.maxHeight === nextStyle.maxHeight
      ? current
      : nextStyle);
  }, [options.length]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition();
    const viewport = window.visualViewport;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateMenuPosition);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    if (menuRef.current) resizeObserver?.observe(menuRef.current);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    viewport?.addEventListener("resize", updateMenuPosition);
    viewport?.addEventListener("scroll", updateMenuPosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      viewport?.removeEventListener("resize", updateMenuPosition);
      viewport?.removeEventListener("scroll", updateMenuPosition);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || !menuStyle) return;
    const selectedOption = menuRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    requestAnimationFrame(() => selectedOption?.focus());
  }, [open, menuStyle]);

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuStyle(getSelectMenuLayout({ trigger: rect, viewport: readViewport(), optionCount: options.length }));
    }
    setOpen(true);
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      toggle();
      return;
    }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current < 0 ? items.length - 1 : current - 1);
    items[next]?.focus();
  };

  return <div ref={rootRef} className={`select-field ${className}`.trim()} onKeyDown={onKeyDown} onBlur={(event) => { const next = event.relatedTarget as Node | null; if (!event.currentTarget.contains(next) && !menuRef.current?.contains(next)) { setOpen(false); onBlur?.(); } }}>
    <button ref={triggerRef} type="button" className="select-field-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-required={required} aria-invalid={invalid || undefined} disabled={disabled} title={title} onClick={toggle}>
      <span>{selected?.label || ariaLabel}</span><ChevronDown size={15} />
    </button>
    {open && createPortal(<div ref={menuRef} id={menuId} className="select-field-menu" role="listbox" aria-label={ariaLabel} style={menuStyle ?? { top: 8, left: 8, width: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)" }}>
      {options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} disabled={option.disabled} key={option.value} onClick={() => choose(option.value)}><span>{option.label}</span>{option.value === value && <Check size={14} />}</button>)}
    </div>, document.body)}
  </div>;
}
