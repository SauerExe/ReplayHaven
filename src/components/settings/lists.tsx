import { useRef } from 'react';
import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * One entity (user, PC, signed-in device): icon or avatar, title with badges, a meta line, at most
 * one visible action and an overflow menu for the rest.
 */
export function ListRow({
  icon,
  title,
  badges,
  meta,
  detail,
  action,
  menu,
  muted = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  /** A second, quieter line below the meta line (e.g. a folder path or an error). */
  detail?: ReactNode;
  action?: ReactNode;
  menu?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="st-list-row" role="listitem" data-muted={muted || undefined}>
      <span className="st-list-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="st-list-text">
        <div className="st-list-title">
          <span className="st-list-name">{title}</span>
          {badges}
        </div>
        {meta && <div className="st-list-meta">{meta}</div>}
        {detail && <div className="st-list-detail">{detail}</div>}
      </div>
      {action && <div className="st-list-action">{action}</div>}
      {menu && <div className="st-list-menu">{menu}</div>}
    </div>
  );
}

/** A round initial for people. */
export function Avatar({ name }: { name: string }) {
  return <span className="st-avatar">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** Gets the menu button, so a dialog can return focus to it. */
  onSelect: (trigger: HTMLButtonElement | null) => void;
  destructive?: boolean;
  hidden?: boolean;
}

/** The ⋯ menu of a list row. Destructive items come last, after a separator. */
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = items.filter((item) => !item.hidden);
  if (!visible.length) return null;
  const regular = visible.filter((item) => !item.destructive);
  const destructive = visible.filter((item) => item.destructive);
  const render = (item: MenuItem) => (
    <Menu.Item
      key={item.label}
      className={item.destructive ? 'destructive' : undefined}
      // Let the menu close first; the dialog then opens with focus handling of its own.
      onSelect={() => setTimeout(() => item.onSelect(trigger.current))}
    >
      {item.icon && <item.icon size={16} aria-hidden="true" />}
      {item.label}
    </Menu.Item>
  );
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger ref={trigger} className="st-icon-button" aria-label={label}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown st-menu" sideOffset={6} align="end">
          {regular.map(render)}
          {regular.length > 0 && destructive.length > 0 && <Menu.Separator />}
          {destructive.map(render)}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
