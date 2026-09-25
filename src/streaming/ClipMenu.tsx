import * as Menu from '@radix-ui/react-dropdown-menu';
import { useRef } from 'react';
import {
  Download,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Share2,
  Tag,
  Trash2,
} from 'lucide-react';
import { linkHandler, type Navigate } from './links';
import type { StreamClip } from './model';

/**
 * Aktionen bekommen den Menü-Knopf mit: Beim Öffnen eines Dialogs ist der Menüpunkt schon weg,
 * ohne Knopf fände der Fokus nach Escape nicht zurück.
 */
type MenuAction = (id: string, opener: HTMLElement | null) => void;

export interface ClipMenuProps {
  clip: StreamClip;
  onPlay?: MenuAction;
  onAddToCollection?: MenuAction;
  onRename?: MenuAction;
  onEditTags?: MenuAction;
  onShare?: MenuAction;
  /** Mit Download-Eintrag, sofern der Clip eine Originaldatei hat. */
  download?: boolean;
  /** Die ausführliche Clip-Seite mit Notizen und KI-Auswertung. */
  pageHref?: string;
  onNavigate?: Navigate;
  onDelete?: MenuAction;
  /** Größe des Auslösers: klein auf Kacheln, rund wie die übrigen Knöpfe im Detaildialog. */
  variant?: 'tile' | 'round';
}

/** Weitere Aktionen zu einem Clip; es erscheinen nur die Einträge, für die es eine Aktion gibt. */
export function ClipMenu({
  clip,
  onPlay,
  onAddToCollection,
  onRename,
  onEditTags,
  onShare,
  download = false,
  pageHref,
  onNavigate,
  onDelete,
  variant = 'tile',
}: ClipMenuProps) {
  const id = clip.id;
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    // Nicht modal: sonst sperrt Radix das Scrollen und die Seite springt.
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={trigger}
        className={variant === 'round' ? 'stream-round' : 'stream-tile-tool'}
        aria-label={`Aktionen für ${clip.title}`}
        title="Weitere Aktionen"
      >
        <MoreHorizontal size={variant === 'round' ? 22 : 18} strokeWidth={2.4} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="stream stream-menu" sideOffset={6} align="end">
          {onPlay && (
            <Menu.Item className="stream-menu-item" onSelect={() => onPlay(id, trigger.current)}>
              <Play size={16} aria-hidden="true" />
              Abspielen
            </Menu.Item>
          )}
          {onAddToCollection && (
            <Menu.Item
              className="stream-menu-item"
              onSelect={() => onAddToCollection(id, trigger.current)}
            >
              <FolderPlus size={16} aria-hidden="true" />
              Zur Sammlung
            </Menu.Item>
          )}
          {onRename && (
            <Menu.Item className="stream-menu-item" onSelect={() => onRename(id, trigger.current)}>
              <Pencil size={16} aria-hidden="true" />
              Umbenennen
            </Menu.Item>
          )}
          {onEditTags && (
            <Menu.Item
              className="stream-menu-item"
              onSelect={() => onEditTags(id, trigger.current)}
            >
              <Tag size={16} aria-hidden="true" />
              Tags bearbeiten
            </Menu.Item>
          )}
          {onShare && (
            <Menu.Item className="stream-menu-item" onSelect={() => onShare(id, trigger.current)}>
              <Share2 size={16} aria-hidden="true" />
              Teilen
            </Menu.Item>
          )}
          {download && clip.downloadUrl && (
            <Menu.Item className="stream-menu-item" asChild>
              <a href={clip.downloadUrl} download={clip.title}>
                <Download size={16} aria-hidden="true" />
                Herunterladen
              </a>
            </Menu.Item>
          )}
          {pageHref && (
            <Menu.Item className="stream-menu-item" asChild>
              <a href={pageHref} onClick={linkHandler(onNavigate, pageHref)}>
                <FileText size={16} aria-hidden="true" />
                Clip-Seite öffnen
              </a>
            </Menu.Item>
          )}
          {onDelete && (
            <>
              <Menu.Separator className="stream-menu-separator" />
              <Menu.Item
                className="stream-menu-item stream-menu-item--danger"
                onSelect={() => onDelete(id, trigger.current)}
              >
                <Trash2 size={16} aria-hidden="true" />
                Löschen
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
