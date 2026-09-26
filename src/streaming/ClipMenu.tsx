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
import { t } from '../i18n';
import { linkHandler, type Navigate } from './links';
import type { StreamClip } from './model';

/**
 * Actions receive the menu button: when a dialog opens the menu item is already gone, and without
 * the button focus could not return after Escape.
 */
type MenuAction = (id: string, opener: HTMLElement | null) => void;

export interface ClipMenuProps {
  clip: StreamClip;
  onPlay?: MenuAction;
  onAddToCollection?: MenuAction;
  onRename?: MenuAction;
  onEditTags?: MenuAction;
  onShare?: MenuAction;
  /** With a download entry, provided the clip has an original file. */
  download?: boolean;
  /** The full clip page with notes and AI analysis. */
  pageHref?: string;
  onNavigate?: Navigate;
  onDelete?: MenuAction;
  /** Trigger size: small on tiles, round like the other buttons in the detail dialog. */
  variant?: 'tile' | 'round';
}

/** More actions for a clip; only entries with an action appear. */
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
    // Not modal: otherwise Radix locks scrolling and the page jumps.
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={trigger}
        className={variant === 'round' ? 'stream-round' : 'stream-tile-tool'}
        aria-label={t('stream.menu.actionsFor', { title: clip.title })}
        title={t('stream.menu.more')}
      >
        <MoreHorizontal size={variant === 'round' ? 22 : 18} strokeWidth={2.4} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="stream stream-menu" sideOffset={6} align="end">
          {onPlay && (
            <Menu.Item className="stream-menu-item" onSelect={() => onPlay(id, trigger.current)}>
              <Play size={16} aria-hidden="true" />
              {t('stream.play')}
            </Menu.Item>
          )}
          {onAddToCollection && (
            <Menu.Item
              className="stream-menu-item"
              onSelect={() => onAddToCollection(id, trigger.current)}
            >
              <FolderPlus size={16} aria-hidden="true" />
              {t('stream.menu.addToCollection')}
            </Menu.Item>
          )}
          {onRename && (
            <Menu.Item className="stream-menu-item" onSelect={() => onRename(id, trigger.current)}>
              <Pencil size={16} aria-hidden="true" />
              {t('stream.menu.rename')}
            </Menu.Item>
          )}
          {onEditTags && (
            <Menu.Item
              className="stream-menu-item"
              onSelect={() => onEditTags(id, trigger.current)}
            >
              <Tag size={16} aria-hidden="true" />
              {t('stream.menu.editTags')}
            </Menu.Item>
          )}
          {onShare && (
            <Menu.Item className="stream-menu-item" onSelect={() => onShare(id, trigger.current)}>
              <Share2 size={16} aria-hidden="true" />
              {t('stream.menu.share')}
            </Menu.Item>
          )}
          {download && clip.downloadUrl && (
            <Menu.Item className="stream-menu-item" asChild>
              <a href={clip.downloadUrl} download={clip.title}>
                <Download size={16} aria-hidden="true" />
                {t('stream.menu.download')}
              </a>
            </Menu.Item>
          )}
          {pageHref && (
            <Menu.Item className="stream-menu-item" asChild>
              <a href={pageHref} onClick={linkHandler(onNavigate, pageHref)}>
                <FileText size={16} aria-hidden="true" />
                {t('stream.menu.openPage')}
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
                {t('common.delete')}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
