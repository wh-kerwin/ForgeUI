export type SelectMenuViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectMenuTriggerRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
};

type SelectMenuLayoutInput = {
  trigger: SelectMenuTriggerRect;
  viewport: SelectMenuViewport;
  optionCount: number;
  measuredHeight?: number;
};

export type SelectMenuLayout = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

const OPTION_HEIGHT = 26;
const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 208;

export function getSelectMenuLayout({
  trigger,
  viewport,
  optionCount,
  measuredHeight = 0,
}: SelectMenuLayoutInput): SelectMenuLayout {
  const viewportWidth = Math.max(1, Number.isFinite(viewport.width) ? viewport.width : 1);
  const viewportHeight = Math.max(1, Number.isFinite(viewport.height) ? viewport.height : 1);
  const marginX = Math.min(8, viewportWidth / 4);
  const marginY = Math.min(8, viewportHeight / 4);
  const viewportRight = viewport.left + viewportWidth;
  const viewportBottom = viewport.top + viewportHeight;
  const availableWidth = Math.max(1, viewportWidth - marginX * 2);
  const minimumWidth = Math.min(160, availableWidth);
  const width = Math.min(Math.max(trigger.width, minimumWidth), availableWidth);
  const minLeft = viewport.left + marginX;
  const maxLeft = Math.max(minLeft, viewportRight - marginX - width);
  const left = Math.min(Math.max(minLeft, trigger.left), maxLeft);

  const estimatedHeight = Math.max(1, optionCount) * OPTION_HEIGHT + 8;
  const desiredHeight = Math.min(MENU_MAX_HEIGHT, Math.max(measuredHeight, estimatedHeight));
  const spaceBelow = Math.max(0, viewportBottom - trigger.bottom - marginY - MENU_GAP);
  const spaceAbove = Math.max(0, trigger.top - viewport.top - marginY - MENU_GAP);
  const opensUp = desiredHeight > spaceBelow && spaceAbove > spaceBelow;
  const availableHeight = opensUp ? spaceAbove : spaceBelow;
  const viewportMaxHeight = Math.max(1, viewportHeight - marginY * 2);
  const minimumVisibleHeight = Math.min(OPTION_HEIGHT + 8, desiredHeight, viewportMaxHeight);
  const maxHeight = Math.min(
    desiredHeight,
    Math.max(availableHeight, minimumVisibleHeight),
    viewportMaxHeight,
  );
  const idealTop = opensUp ? trigger.top - MENU_GAP - maxHeight : trigger.bottom + MENU_GAP;
  const minTop = viewport.top + marginY;
  const maxTop = Math.max(minTop, viewportBottom - marginY - maxHeight);
  const top = Math.min(Math.max(minTop, idealTop), maxTop);

  return { top, left, width, maxHeight };
}
