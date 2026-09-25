import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';

/**
 * The building blocks of every settings section (docs/SETTINGS-DESIGN.md): a page with a header,
 * groups as the only bordered surface, and rows with one pattern (text left, control right).
 */

export function SettingsPage({
  id,
  title,
  description,
  badge,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  /** Small status next to the title, e.g. a count or "Sample data". */
  badge?: ReactNode;
  /** At most one primary action, on the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `settings-${id}-title`;
  return (
    <section className="st-page" aria-labelledby={titleId}>
      <header className="st-page-header">
        <div className="st-page-heading">
          <h1 id={titleId}>
            {title}
            {badge}
          </h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="st-page-actions">{actions}</div>}
      </header>
      <div className="st-groups">{children}</div>
    </section>
  );
}

export function SettingsGroup({
  title,
  description,
  action,
  footer,
  tone,
  list = false,
  live = false,
  children,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  /** One muted note or callout, inside the group. */
  footer?: ReactNode;
  tone?: 'accent' | 'danger';
  /** The body holds list rows (users, PCs, sessions). */
  list?: boolean;
  /** Announce new rows (pairing requests) to screen readers. */
  live?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className="st-group"
      data-tone={tone}
      role="group"
      aria-labelledby={title ? `${id}-title` : undefined}
    >
      {title && (
        <header className="st-group-header">
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action && <div className="st-group-action">{action}</div>}
        </header>
      )}
      <div
        className="st-group-body"
        role={list ? 'list' : undefined}
        aria-live={live ? 'polite' : undefined}
      >
        {children}
      </div>
      {footer && <footer className="st-group-footer">{footer}</footer>}
    </div>
  );
}

interface RowIds {
  labelId: string;
  descriptionId?: string;
}
const RowContext = createContext<RowIds | null>(null);
/** Ids of the surrounding row, so a control is labelled by the row label. */
export const useRowIds = () => useContext(RowContext);

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The control: switch, select, segmented control, button, badge or value. */
  children?: ReactNode;
}) {
  const id = useId();
  const ids: RowIds = {
    labelId: `${id}-label`,
    descriptionId: description ? `${id}-description` : undefined,
  };
  return (
    <RowContext.Provider value={ids}>
      <div className="st-row">
        <div className="st-row-text">
          <div className="st-row-label" id={ids.labelId}>
            {label}
          </div>
          {description && (
            <div className="st-row-description" id={ids.descriptionId}>
              {description}
            </div>
          )}
        </div>
        {children && <div className="st-row-control">{children}</div>}
      </div>
    </RowContext.Provider>
  );
}

/** A read-only value on the right of a row (storage figures, names). */
export function RowValue({ children }: { children: ReactNode }) {
  return <span className="st-value">{children}</span>;
}

/** Empty state inside a group: icon, one sentence, one action. */
export function EmptyGroup({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="st-empty">
      <span className="st-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Always the last group of a page; destructive actions only. */
export function DangerZone({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <SettingsGroup tone="danger" title={title ?? t('settings.dangerZone')}>
      {children}
    </SettingsGroup>
  );
}
