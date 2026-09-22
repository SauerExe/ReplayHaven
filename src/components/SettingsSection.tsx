import type { ComponentType, ReactNode } from 'react';
export interface SettingsArea {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
}
export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="settings-section">
      <header className="settings-section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {aside && <div className="settings-section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
