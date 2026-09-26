import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { createId } from '../data/id';
import {
  Check,
  Copy,
  Download,
  FolderPlus,
  Heart,
  MoreHorizontal,
  Pencil,
  Play,
  Share2,
  Trash2,
  UploadCloud,
  X,
  AlertCircle,
  ExternalLink,
  Folder,
  Film,
  Search,
  Tag,
  RotateCcw,
  LoaderCircle,
  HardDrive,
  Monitor,
  ArrowRight,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useVault } from '../data/store';
import { useCanEdit } from './AuthGate';
import { createSeed, games } from '../data/seed';
import type { Clip } from '../domain/models';
import { filterClips, time } from '../data/repository';
import { Artwork } from './Artwork';
import { locale, t, tp, tx } from '../i18n';
type Action =
  | { kind: 'add' | 'delete'; ids: string[] }
  | { kind: 'rename' | 'share' | 'tags'; id: string }
  | { kind: 'create' | 'upload' }
  | { kind: 'editCollection' | 'deleteCollection' | 'addClips'; id: string }
  | { kind: 'reset' };
const ActionsContext = createContext<(action: Action, opener?: HTMLElement | null) => void>(
  () => {},
);
export const useActions = () => useContext(ActionsContext);
export function ActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<Action | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((next: Action, returnFocus?: HTMLElement | null) => {
    opener.current =
      returnFocus ||
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setAction(next);
  }, []);
  return (
    <ActionsContext.Provider value={open}>
      {children}
      <Dialog.Root
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        {action && (
          <ActionDialog
            key={JSON.stringify(action)}
            action={action}
            close={() => setAction(null)}
            restoreFocus={() => {
              if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
            }}
          />
        )}
      </Dialog.Root>
    </ActionsContext.Provider>
  );
}
function ActionDialog({
  action,
  close,
  restoreFocus,
}: {
  action: Action;
  close: () => void;
  restoreFocus: () => void;
}) {
  const { state, setState, patchClip, toast, jobs, importFiles, server, removeClips } = useVault();
  const navigate = useNavigate();
  const clip = 'id' in action ? state.clips.find((c) => c.id === action.id) : undefined;
  const collection = 'id' in action ? state.collections.find((c) => c.id === action.id) : undefined;
  const [value, setValue] = useState(
    action.kind === 'tags'
      ? clip?.tags.join(', ') || ''
      : action.kind === 'rename'
        ? clip?.title || ''
        : action.kind === 'editCollection'
          ? collection?.title || ''
          : '',
  );
  const [description, setDescription] = useState(collection?.description || '');
  const [picked, setPicked] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const dragDepth = useRef(0);
  const title = t(`app.actions.title.${action.kind}`);
  const dialogDescription = t(`app.actions.description.${action.kind}`);
  const symbols = {
    add: FolderPlus,
    addClips: Film,
    create: FolderPlus,
    editCollection: Pencil,
    rename: Pencil,
    tags: Tag,
    upload: UploadCloud,
    share: Share2,
    delete: Trash2,
    deleteCollection: Trash2,
    reset: RotateCcw,
  };
  const Symbol = symbols[action.kind];
  const destructive = ['delete', 'deleteCollection', 'reset'].includes(action.kind);
  const availableClips =
    action.kind === 'addClips'
      ? state.clips.filter((item) => !collection?.clipIds.includes(item.id))
      : [];
  const selectable = action.kind === 'add' ? state.collections : availableClips;
  const visibleItems =
    action.kind === 'addClips'
      ? filterClips(availableClips, { query })
      : selectable.filter((item) =>
          `${item.title} ${item.description || ''}`
            .toLocaleLowerCase(locale())
            .includes(query.trim().toLocaleLowerCase(locale())),
        );
  const pickedIds = picked.filter((id) => selectable.some((item) => item.id === id));
  const allVisiblePicked =
    visibleItems.length > 0 && visibleItems.every((item) => pickedIds.includes(item.id));
  const collectionClips = collection
    ? state.clips.filter((item) => collection.clipIds.includes(item.id))
    : [];
  const serverUpload = server.connected && !localOnly;
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (
        action.kind === 'rename' &&
        value.trim() &&
        !(await patchClip(action.id, { title: value.trim() }))
      )
        return;
      if (action.kind === 'tags')
        if (
          !(await patchClip(action.id, {
            tags: [
              ...new Set(
                value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              ),
            ],
          }))
        )
          return;
      if (action.kind === 'create' && value.trim()) {
        const id = createId();
        setState((s) => ({
          ...s,
          collections: [
            ...s.collections,
            {
              id,
              title: value.trim(),
              description,
              clipIds: [],
              updatedAt: new Date().toISOString(),
            },
          ],
        }));
        navigate(`/collections/${id}`);
      }
      if (action.kind === 'editCollection' && value.trim())
        setState((s) => ({
          ...s,
          collections: s.collections.map((c) =>
            c.id === action.id
              ? { ...c, title: value.trim(), description, updatedAt: new Date().toISOString() }
              : c,
          ),
        }));
      if (action.kind === 'delete') await removeClips(action.ids);
      if (action.kind === 'deleteCollection') {
        setState((s) => ({ ...s, collections: s.collections.filter((c) => c.id !== action.id) }));
        navigate('/collections');
      }
      if (action.kind === 'add')
        setState((s) => ({
          ...s,
          collections: s.collections.map((c) =>
            pickedIds.includes(c.id)
              ? {
                  ...c,
                  clipIds: [...new Set([...c.clipIds, ...action.ids])],
                  updatedAt: new Date().toISOString(),
                }
              : c,
          ),
        }));
      if (action.kind === 'addClips')
        setState((s) => ({
          ...s,
          collections: s.collections.map((c) =>
            c.id === action.id
              ? {
                  ...c,
                  clipIds: [...new Set([...c.clipIds, ...pickedIds])],
                  updatedAt: new Date().toISOString(),
                }
              : c,
          ),
        }));
      close();
      toast(
        action.kind === 'delete' || action.kind === 'deleteCollection'
          ? t('app.actions.toast.deleted')
          : t('app.actions.toast.saved'),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t('app.actions.toast.saveFailed'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content
        className={`dialog action-dialog ${action.kind === 'upload' ? 'upload-dialog' : ''} ${action.kind === 'add' || action.kind === 'addClips' ? 'picker-dialog' : ''} ${destructive ? 'destructive-dialog' : ''}`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="dialog-heading">
          <span className="dialog-symbol" aria-hidden="true">
            <Symbol size={23} strokeWidth={1.5} />
          </span>
          <div>
            <span className="eyebrow">{t('app.actions.eyebrow')}</span>
            <Dialog.Title>{title}</Dialog.Title>
          </div>
          <Dialog.Close className="icon-button" aria-label={t('app.actions.closeDialog')}>
            <X size={21} />
          </Dialog.Close>
        </div>
        <Dialog.Description className="muted dialog-description">
          {dialogDescription}
        </Dialog.Description>
        {['rename', 'tags', 'create', 'editCollection'].includes(action.kind) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="dialog-form-content">
              {['create', 'editCollection'].includes(action.kind) && (
                <div className="collection-draft-preview" aria-hidden="true">
                  <div className="draft-preview-art">
                    {collectionClips.slice(0, 3).map((item) => (
                      <Artwork key={item.id} src={item.thumbnail} sizes="200px" />
                    ))}
                  </div>
                  <span className="draft-folder">
                    <Folder size={22} strokeWidth={1.5} />
                  </span>
                  <div>
                    <span className="eyebrow">{t('app.actions.draft.eyebrow')}</span>
                    <strong>{value.trim() || t('app.actions.draft.namePlaceholder')}</strong>
                    <small>
                      {collectionClips.length
                        ? tp('common.clips', collectionClips.length)
                        : t('app.actions.draft.empty')}
                    </small>
                  </div>
                </div>
              )}
              <label className="field">
                {action.kind === 'tags'
                  ? t('app.actions.field.tags')
                  : t('app.actions.field.title')}
                <input
                  autoFocus
                  value={value}
                  maxLength={action.kind === 'tags' ? 250 : 100}
                  required={action.kind !== 'tags'}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={
                    action.kind === 'tags'
                      ? t('app.actions.field.tagsPlaceholder')
                      : t('app.actions.field.titlePlaceholder')
                  }
                />
              </label>
              {['create', 'editCollection'].includes(action.kind) && (
                <label className="field">
                  <span>
                    {t('app.actions.field.description')}{' '}
                    <span className="muted">{t('app.actions.field.optional')}</span>
                  </span>
                  <textarea
                    value={description}
                    maxLength={400}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('app.actions.field.descriptionPlaceholder')}
                  />
                </label>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="button secondary" onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                className="button primary"
                disabled={saving || (action.kind !== 'tags' && !value.trim())}
              >
                {saving && <LoaderCircle className="saving-spinner" size={16} />}
                {saving
                  ? t('app.actions.saving')
                  : action.kind === 'create'
                    ? t('app.actions.createCollection')
                    : t('common.save')}
              </button>
            </div>
          </form>
        )}
        {(action.kind === 'add' || action.kind === 'addClips') && (
          <>
            {selectable.length > 0 && (
              <div className="picker-tools">
                <label className="picker-search">
                  <Search size={17} />
                  <input
                    autoFocus
                    aria-label={
                      action.kind === 'add'
                        ? t('app.actions.picker.searchCollectionsLabel')
                        : t('app.actions.picker.searchClipsLabel')
                    }
                    placeholder={
                      action.kind === 'add'
                        ? t('app.actions.picker.searchCollectionsPlaceholder')
                        : t('app.search.placeholder')
                    }
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label={t('app.actions.picker.clearSearch')}
                      onClick={() => setQuery('')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
                <div className="picker-summary">
                  <span>
                    {tp(
                      action.kind === 'add'
                        ? query
                          ? 'app.actions.picker.collectionsFound'
                          : 'app.actions.picker.collectionsAvailable'
                        : query
                          ? 'app.actions.picker.clipsFound'
                          : 'app.actions.picker.clipsAvailable',
                      visibleItems.length,
                    )}
                  </span>
                  {visibleItems.length > 0 && (
                    <button
                      className="text-button"
                      disabled={saving}
                      onClick={() =>
                        setPicked((previous) =>
                          allVisiblePicked
                            ? previous.filter((id) => !visibleItems.some((item) => item.id === id))
                            : [...new Set([...previous, ...visibleItems.map((item) => item.id)])],
                        )
                      }
                    >
                      {allVisiblePicked
                        ? t('app.actions.picker.deselectVisible')
                        : t('app.actions.picker.selectVisible')}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="selection-list">
              {selectable.length === 0 ? (
                <div className="picker-empty">
                  <FolderPlus size={30} strokeWidth={1.3} />
                  <h3>
                    {action.kind === 'add'
                      ? t('app.actions.picker.noCollections')
                      : state.clips.length === 0
                        ? t('app.actions.picker.noClips')
                        : t('app.actions.picker.allAdded')}
                  </h3>
                  <p>
                    {action.kind === 'add'
                      ? t('app.actions.picker.noCollectionsText')
                      : state.clips.length === 0
                        ? t('app.actions.picker.noClipsText')
                        : t('app.actions.picker.allAddedText')}
                  </p>
                  {action.kind === 'add' && (
                    <Link className="text-link" to="/collections" onClick={close}>
                      {t('app.actions.picker.toCollections')}
                      <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="picker-empty">
                  <Search size={29} strokeWidth={1.4} />
                  <h3>{t('app.actions.picker.noResults')}</h3>
                  <p>{t('app.actions.picker.noResultsText')}</p>
                  <button className="text-link" onClick={() => setQuery('')}>
                    {t('app.actions.picker.resetSearch')}
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <label key={item.id} className="selection-option">
                    <input
                      type="checkbox"
                      aria-label={item.title}
                      disabled={saving}
                      checked={pickedIds.includes(item.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, item.id] : p.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span className="picker-artwork" aria-hidden="true">
                      {'thumbnail' in item ? (
                        <Artwork src={item.thumbnail} sizes="80px" />
                      ) : (
                        <Folder size={21} strokeWidth={1.4} />
                      )}
                    </span>
                    <span className="selection-copy">
                      <strong>{item.title}</strong>
                      <small>
                        {'clipIds' in item
                          ? tp(
                              'common.clips',
                              item.clipIds.filter((id) =>
                                state.clips.some((clip) => clip.id === id),
                              ).length,
                            )
                          : `${games.find((game) => game.id === item.gameId)?.name || item.gameName || t('app.clip.fallbackGame')} · ${time(item.duration)}`}
                      </small>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="dialog-footer">
              <span className="picker-count" role="status">
                {tx('app.actions.picker.selected', { count: <strong>{pickedIds.length}</strong> })}
              </span>
              <button className="button secondary" onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                className="button primary"
                onClick={save}
                disabled={saving || !pickedIds.length}
              >
                <FolderPlus size={17} />
                {t('app.actions.picker.add')}
              </button>
            </div>
          </>
        )}
        {['delete', 'deleteCollection'].includes(action.kind) && (
          <>
            <div className="delete-summary">
              <span>
                <Trash2 size={19} />
              </span>
              <div>
                <strong>
                  {action.kind === 'deleteCollection'
                    ? collection?.title
                    : action.kind === 'delete' && action.ids.length === 1
                      ? state.clips.find((item) => item.id === action.ids[0])?.title
                      : action.kind === 'delete'
                        ? tp('app.actions.delete.selected', action.ids.length)
                        : ''}
                </strong>
                <small>
                  {action.kind === 'deleteCollection'
                    ? t('app.actions.delete.keepClips')
                    : t('app.actions.delete.keepOriginals')}
                </small>
              </div>
            </div>
            <div className="dialog-footer">
              <button className="button secondary" onClick={close}>
                {t('common.cancel')}
              </button>
              <button className="button danger" disabled={saving} onClick={save}>
                {action.kind === 'delete' &&
                action.ids.some((id) => state.clips.find((c) => c.id === id)?.server)
                  ? t('app.actions.delete.removeFromLibrary')
                  : t('app.actions.delete.permanent')}
              </button>
            </div>
          </>
        )}
        {action.kind === 'reset' && (
          <div className="dialog-footer">
            <button className="button secondary" onClick={close}>
              {t('common.cancel')}
            </button>
            <button
              className="button danger"
              onClick={() => {
                setState((s) => ({
                  ...createSeed(),
                  clips: [...s.clips.filter((c) => c.server), ...createSeed().clips],
                }));
                close();
                toast(t('app.actions.reset.toast'));
              }}
            >
              {t('app.actions.reset.confirm')}
            </button>
          </div>
        )}
        {action.kind === 'share' && clip && (
          <>
            <div className="notice">
              <AlertCircle size={20} />
              <p>{t('app.actions.share.notice')}</p>
            </div>
            <div className="share-preview">
              <div className="share-preview-art" aria-hidden="true">
                <Artwork src={clip.thumbnail} sizes="480px" />
              </div>
              <div>
                <span className="eyebrow">{t('app.actions.share.eyebrow')}</span>
                <p>{clip.title}</p>
              </div>
            </div>
            <div className="dialog-footer">
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}/share/preview-${clip.id}`,
                    );
                    setCopied(true);
                  } catch {
                    toast(t('app.actions.share.copyFailed'));
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                {copied ? t('app.actions.share.copied') : t('app.actions.share.copy')}
              </button>
              <Link className="button primary" to={`/share/preview-${clip.id}`} onClick={close}>
                {t('app.actions.share.open')} <ExternalLink size={16} />
              </Link>
            </div>
          </>
        )}
        {action.kind === 'upload' && (
          <>
            <div className="upload-destination">
              <span>{serverUpload ? <HardDrive size={19} /> : <Monitor size={19} />}</span>
              <div>
                <strong>
                  {serverUpload
                    ? t('app.actions.upload.serverTitle')
                    : t('app.actions.upload.browserTitle')}
                </strong>
                <small>
                  {serverUpload
                    ? t('app.actions.upload.serverHint')
                    : t('app.actions.upload.browserHint')}
                </small>
              </div>
              <span className={`upload-destination-badge${serverUpload ? ' online' : ''}`}>
                {serverUpload ? t('app.status.connected') : t('app.status.local')}
              </span>
            </div>
            {server.connected && (
              <label className="upload-mode">
                <input
                  type="checkbox"
                  checked={localOnly}
                  onChange={(e) => setLocalOnly(e.target.checked)}
                />
                {t('app.actions.upload.localOnly')}
              </label>
            )}
            <div
              className={`dropzone ${dragging ? 'dragging' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                void importFiles([...e.dataTransfer.files], localOnly);
              }}
            >
              <div className="upload-illustration" aria-hidden="true">
                <span className="upload-file-back">
                  <Film size={25} strokeWidth={1.4} />
                </span>
                <span className="upload-file-front">
                  <UploadCloud size={34} strokeWidth={1.3} />
                </span>
              </div>
              <h3>
                {dragging ? t('app.actions.upload.dropHere') : t('app.actions.upload.nextMoment')}
              </h3>
              <p>{t('app.actions.upload.dropText')}</p>
              <label className="button primary file-label">
                {t('app.actions.upload.chooseFiles')}
                <input
                  aria-label={t('app.actions.upload.chooseFilesLabel')}
                  type="file"
                  multiple
                  accept={
                    server.connected && !localOnly
                      ? '.mp4,.webm,.mov,.m4v,.mkv'
                      : '.mp4,.webm,.mov,.m4v'
                  }
                  onChange={(e) => {
                    void importFiles([...(e.target.files || [])], localOnly);
                    e.target.value = '';
                  }}
                />
              </label>
              <small>
                {t('app.actions.upload.limits', {
                  formats: serverUpload ? 'MP4, WebM, MOV, M4V, MKV' : 'MP4, WebM, MOV, M4V',
                })}
              </small>
            </div>
            <div className="notice">
              <AlertCircle size={19} />
              <p>
                {server.connected && !localOnly
                  ? t('app.actions.upload.serverNotice', {
                      analysis:
                        server.configured && server.settings.autoAnalyze
                          ? t('app.actions.upload.autoAnalysis')
                          : t('app.actions.upload.manualAnalysis'),
                    })
                  : t('app.actions.upload.localNotice')}
              </p>
            </div>
            <div className="upload-jobs" aria-live="polite">
              {jobs.length > 0 && (
                <div className="upload-jobs-heading">
                  <h3>{t('app.actions.upload.files')}</h3>
                  <span>
                    {t('app.actions.upload.done', {
                      done: jobs.filter((job) => job.status === 'complete').length,
                      total: jobs.length,
                    })}
                  </span>
                </div>
              )}
              {jobs.map((job) => (
                <div className="upload-job" key={job.id}>
                  {job.status === 'error' ? (
                    <AlertCircle className="error" size={20} />
                  ) : job.status === 'complete' ? (
                    <Check className="success" size={20} />
                  ) : (
                    <UploadCloud size={20} />
                  )}
                  <div>
                    <strong>{job.name}</strong>
                    <small>
                      {job.error ||
                        (job.status === 'complete'
                          ? job.server
                            ? t('app.actions.upload.savedOnServer')
                            : t('app.actions.upload.localReady')
                          : job.server
                            ? t('app.actions.upload.progress', { progress: job.progress })
                            : t('app.actions.upload.checking'))}
                    </small>
                    {job.status === 'reading' && (
                      <progress
                        aria-label={t('app.actions.upload.progressLabel', { name: job.name })}
                        max={100}
                        value={job.progress}
                      />
                    )}
                  </div>
                  {job.clipId && (
                    <Link
                      className="icon-button"
                      aria-label={t('app.clip.play', { title: job.name })}
                      to={`/clips/${job.clipId}`}
                      onClick={close}
                    >
                      <Play size={18} />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
export function ClipMenu({ clip }: { clip: Clip }) {
  const action = useActions();
  const { patchClip } = useVault();
  // Plain accounts may not change server clips: favorite, rename and delete are left out.
  const editable = useCanEdit(clip);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={trigger}
        className="icon-button clip-menu"
        aria-label={t('app.menu.label', { title: clip.title })}
      >
        <MoreHorizontal size={20} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown" sideOffset={6} align="end">
          <Menu.Item asChild>
            <Link to={`/clips/${clip.id}`}>
              <Play size={16} />
              {t('app.menu.play')}
            </Link>
          </Menu.Item>
          {editable && (
            <Menu.Item onSelect={() => patchClip(clip.id, { favorite: !clip.favorite })}>
              <Heart size={16} />
              {clip.favorite ? t('app.menu.unfavorite') : t('app.menu.favorite')}
            </Menu.Item>
          )}
          <Menu.Item onSelect={() => action({ kind: 'add', ids: [clip.id] }, trigger.current)}>
            <FolderPlus size={16} />
            {t('app.menu.addToCollection')}
          </Menu.Item>
          {editable && (
            <Menu.Item onSelect={() => action({ kind: 'rename', id: clip.id }, trigger.current)}>
              <Pencil size={16} />
              {t('app.menu.rename')}
            </Menu.Item>
          )}
          <Menu.Item onSelect={() => action({ kind: 'share', id: clip.id }, trigger.current)}>
            <Share2 size={16} />
            {t('app.menu.share')}
          </Menu.Item>
          {(clip.server || (clip.local && clip.videoSource)) && (
            <Menu.Item asChild>
              <a
                href={clip.server ? `/api/clips/${clip.id}/download` : clip.videoSource}
                download={clip.title}
              >
                <Download size={16} />
                {t('app.menu.download')}
              </a>
            </Menu.Item>
          )}
          {editable && (
            <>
              <Menu.Separator />
              <Menu.Item
                className="destructive"
                onSelect={() => action({ kind: 'delete', ids: [clip.id] }, trigger.current)}
              >
                <Trash2 size={16} />
                {t('common.delete')}
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
