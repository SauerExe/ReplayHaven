import type { ComponentType, ReactNode } from 'react';
import { Database, Gamepad2, Monitor, Palette, Play, Server, User } from 'lucide-react';

const sectionIcons: Record<string, typeof User> = {
  analysis: Server,
  games: Gamepad2,
  profile: User,
  playback: Play,
  appearance: Palette,
  storage: Database,
  devices: Monitor,
};
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
  const Icon = sectionIcons[id];
  return (
    <section id={id} className="settings-section" aria-labelledby={`${id}-heading`}>
      <header className="settings-section-head">
        {Icon && (
          <span className="settings-section-icon" aria-hidden="true">
            <Icon size={20} strokeWidth={1.5} />
          </span>
        )}
        <div>
          <h2 id={`${id}-heading`}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {aside && <div className="settings-section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
