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
import { createSeed, games } from '../data/seed';
import type { Clip } from '../domain/models';
import { filterClips, time } from '../data/repository';
import { Artwork } from './Artwork';
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
  const titles = {
    add: 'Zur Sammlung hinzufügen',
    delete: 'Clips löschen?',
    rename: 'Clip umbenennen',
    share: 'Clip teilen',
    tags: 'Tags bearbeiten',
    create: 'Neue Sammlung',
    upload: 'Clips hinzufügen',
    editCollection: 'Sammlung bearbeiten',
    deleteCollection: 'Sammlung löschen?',
    addClips: 'Clips auswählen',
    reset: 'Beispieldaten zurücksetzen?',
  };
  const descriptions: Record<Action['kind'], string> = {
    add: 'Wähle die Sammlungen, in denen du diese Momente wiederfinden möchtest.',
    addClips: 'Finde die passenden Clips. Deine Auswahl bleibt beim Suchen erhalten.',
    create:
      'Ein eigener Platz für deine Lieblingsmomente. Clips fügst du im nächsten Schritt hinzu.',
    editCollection: 'Passe Titel und Beschreibung deiner Sammlung an.',
    rename: 'So heißt dieser Moment in deinem Archiv. Die Originaldatei bleibt unverändert.',
    tags: 'Mit Tags findest du deine Clips später schneller wieder.',
    upload: 'Bring deine Aufnahmen in deinen Vault.',
    share: 'Sieh dir an, wie dein Clip in der reduzierten Freigabeansicht aussieht.',
    delete:
      'Die ausgewählten Einträge werden aus der Bibliothek und allen Sammlungen entfernt. Originaldateien bleiben erhalten.',
    deleteCollection: 'Die Sammlung wird entfernt. Deine Clips bleiben in der Bibliothek.',
    reset:
      'Titel, Favoriten, Sammlungen und Einstellungen werden zurückgesetzt. Lokale Vorschauen werden entfernt.',
  };
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
            .toLocaleLowerCase('de')
            .includes(query.trim().toLocaleLowerCase('de')),
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
        action.kind === 'delete' || action.kind === 'deleteCollection' ? 'Gelöscht' : 'Gespeichert',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
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
            <span className="eyebrow">DEIN REPLAYHAVEN</span>
            <Dialog.Title>{titles[action.kind]}</Dialog.Title>
          </div>
          <Dialog.Close className="icon-button" aria-label="Dialog schließen">
            <X size={21} />
          </Dialog.Close>
        </div>
        <Dialog.Description className="muted dialog-description">
          {descriptions[action.kind]}
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
                    <span className="eyebrow">DEINE SAMMLUNG</span>
                    <strong>{value.trim() || 'Name deiner Sammlung'}</strong>
                    <small>
                      {collectionClips.length
                        ? `${collectionClips.length} Clips`
                        : 'Platz für neue Momente'}
                    </small>
                  </div>
                </div>
              )}
              <label className="field">
                {action.kind === 'tags' ? 'Tags, durch Kommas getrennt' : 'Titel'}
                <input
                  autoFocus
                  value={value}
                  maxLength={action.kind === 'tags' ? 250 : 100}
                  required={action.kind !== 'tags'}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={
                    action.kind === 'tags'
                      ? 'Clutch, Mit Freunden, Highlight'
                      : 'Zum Beispiel: Unsere besten Runden'
                  }
                />
              </label>
              {['create', 'editCollection'].includes(action.kind) && (
                <label className="field">
                  <span>
                    Beschreibung <span className="muted">(optional)</span>
                  </span>
                  <textarea
                    value={description}
                    maxLength={400}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Was gehört hier rein?"
                  />
                </label>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="button secondary" onClick={close}>
                Abbrechen
              </button>
              <button
                className="button primary"
                disabled={saving || (action.kind !== 'tags' && !value.trim())}
              >
                {saving && <LoaderCircle className="saving-spinner" size={16} />}
                {saving
                  ? 'Wird gespeichert …'
                  : action.kind === 'create'
                    ? 'Sammlung erstellen'
                    : 'Speichern'}
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
                      action.kind === 'add' ? 'Sammlungen durchsuchen' : 'Clips auswählen: Suche'
                    }
                    placeholder={
                      action.kind === 'add'
                        ? 'Sammlungen suchen …'
                        : 'Clips, Spiele oder Tags suchen …'
                    }
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Auswahlsuche löschen"
                      onClick={() => setQuery('')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
                <div className="picker-summary">
                  <span>
                    {visibleItems.length} {action.kind === 'add' ? 'Sammlungen' : 'Clips'}
                    {query ? ' gefunden' : ' verfügbar'}
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
                      {allVisiblePicked ? 'Sichtbare abwählen' : 'Sichtbare auswählen'}
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
                      ? 'Noch keine Sammlung'
                      : state.clips.length === 0
                        ? 'Noch keine Clips'
                        : 'Hier ist schon alles drin.'}
                  </h3>
                  <p>
                    {action.kind === 'add'
                      ? 'Erstelle eine Sammlung und gib deinen Clips einen gemeinsamen Platz.'
                      : state.clips.length === 0
                        ? 'Füge zuerst einen Clip zu deiner Bibliothek hinzu.'
                        : 'Alle verfügbaren Clips sind bereits in dieser Sammlung.'}
                  </p>
                  {action.kind === 'add' && (
                    <Link className="text-link" to="/collections" onClick={close}>
                      Zu den Sammlungen
                      <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="picker-empty">
                  <Search size={29} strokeWidth={1.4} />
                  <h3>Keine Treffer</h3>
                  <p>Versuche einen anderen Titel, ein Spiel oder einen Tag.</p>
                  <button className="text-link" onClick={() => setQuery('')}>
                    Suche zurücksetzen
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
                          ? `${item.clipIds.filter((id) => state.clips.some((clip) => clip.id === id)).length} Clips`
                          : `${games.find((game) => game.id === item.gameId)?.name || item.gameName || 'Deine Aufnahme'} · ${time(item.duration)}`}
                      </small>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="dialog-footer">
              <span className="picker-count" role="status">
                <strong>{pickedIds.length}</strong> ausgewählt
              </span>
              <button className="button secondary" onClick={close}>
                Abbrechen
              </button>
              <button
                className="button primary"
                onClick={save}
                disabled={saving || !pickedIds.length}
              >
                <FolderPlus size={17} />
                Hinzufügen
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
                        ? `${action.ids.length} ausgewählte Clips`
                        : ''}
                </strong>
                <small>
                  {action.kind === 'deleteCollection'
                    ? 'Clips in deiner Bibliothek bleiben erhalten.'
                    : 'Originaldateien bleiben erhalten.'}
                </small>
              </div>
            </div>
            <div className="dialog-footer">
              <button className="button secondary" onClick={close}>
                Abbrechen
              </button>
              <button className="button danger" disabled={saving} onClick={save}>
                {action.kind === 'delete' &&
                action.ids.some((id) => state.clips.find((c) => c.id === id)?.server)
                  ? 'Aus Bibliothek entfernen'
                  : 'Endgültig löschen'}
              </button>
            </div>
          </>
        )}
        {action.kind === 'reset' && (
          <div className="dialog-footer">
            <button className="button secondary" onClick={close}>
              Abbrechen
            </button>
            <button
              className="button danger"
              onClick={() => {
                setState((s) => ({
                  ...createSeed(),
                  clips: [...s.clips.filter((c) => c.server), ...createSeed().clips],
                }));
                close();
                toast('Beispieldaten zurückgesetzt');
              }}
            >
              Zurücksetzen
            </button>
          </div>
        )}
        {action.kind === 'share' && clip && (
          <>
            <div className="notice">
              <AlertCircle size={20} />
              <p>
                Öffentliches Teilen ist noch nicht verfügbar. Diese Vorschau funktioniert
                ausschließlich in diesem Browser und bietet keine Zugriffskontrolle.
              </p>
            </div>
            <div className="share-preview">
              <div className="share-preview-art" aria-hidden="true">
                <Artwork src={clip.thumbnail} sizes="480px" />
              </div>
              <div>
                <span className="eyebrow">LOKALE VORSCHAU</span>
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
                    toast('Kopieren nicht möglich. Öffne die Vorschau und kopiere die Adresse.');
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                {copied ? 'Vorschau-Adresse kopiert' : 'Vorschau-Adresse kopieren'}
              </button>
              <Link className="button primary" to={`/share/preview-${clip.id}`} onClick={close}>
                Vorschau <ExternalLink size={16} />
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
                  {serverUpload ? 'Dein Archiv-Server' : 'Vorschau in diesem Browser'}
                </strong>
                <small>
                  {serverUpload
                    ? 'Die Originaldatei wird auf deinem Server gespeichert.'
                    : 'Für dauerhaftes Archivieren einen Server verbinden.'}
                </small>
              </div>
              <span className={`upload-destination-badge${serverUpload ? ' online' : ''}`}>
                {serverUpload ? 'Verbunden' : 'Lokal'}
              </span>
            </div>
            {server.connected && (
              <label className="upload-mode">
                <input
                  type="checkbox"
                  checked={localOnly}
                  onChange={(e) => setLocalOnly(e.target.checked)}
                />
                Nur lokal ansehen, nicht auf den Server laden
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
              <h3>{dragging ? 'Hier loslassen.' : 'Dein nächster Moment.'}</h3>
              <p>Videos hier ablegen oder Dateien auswählen.</p>
              <label className="button primary file-label">
                Dateien auswählen
                <input
                  aria-label="Videodateien auswählen"
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
                {serverUpload ? 'MP4, WebM, MOV, M4V, MKV' : 'MP4, WebM, MOV, M4V'} · Max. 2 GB pro
                Datei
              </small>
            </div>
            <div className="notice">
              <AlertCircle size={19} />
              <p>
                {server.connected && !localOnly
                  ? `Die Originaldatei wird auf deinem Server archiviert. ${server.configured && server.settings.autoAnalyze ? 'Danach startet die KI-Analyse automatisch.' : 'Eine KI-Analyse startet nach der Einrichtung oder manuell.'}`
                  : 'Nur in diesem Browser verfügbar – noch nicht auf dem Server gespeichert. Nach dem Neuladen musst du lokale Videos erneut auswählen.'}
              </p>
            </div>
            <div className="upload-jobs" aria-live="polite">
              {jobs.length > 0 && (
                <div className="upload-jobs-heading">
                  <h3>Deine Dateien</h3>
                  <span>
                    {jobs.filter((job) => job.status === 'complete').length} von {jobs.length}{' '}
                    fertig
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
                            ? 'Auf dem Server gespeichert'
                            : 'Lokale Vorschau bereit'
                          : job.server
                            ? `Upload ${job.progress} %`
                            : 'Videodatei wird geprüft …')}
                    </small>
                    {job.status === 'reading' && (
                      <progress
                        aria-label={`Fortschritt für ${job.name}`}
                        max={100}
                        value={job.progress}
                      />
                    )}
                  </div>
                  {job.clipId && (
                    <Link
                      className="icon-button"
                      aria-label={`${job.name} abspielen`}
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
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={trigger}
        className="icon-button clip-menu"
        aria-label={`Aktionen für ${clip.title}`}
      >
        <MoreHorizontal size={20} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="dropdown" sideOffset={6} align="end">
          <Menu.Item asChild>
            <Link to={`/clips/${clip.id}`}>
              <Play size={16} />
              Abspielen
            </Link>
          </Menu.Item>
          <Menu.Item onSelect={() => patchClip(clip.id, { favorite: !clip.favorite })}>
            <Heart size={16} />
            {clip.favorite ? 'Favorit entfernen' : 'Favorisieren'}
          </Menu.Item>
          <Menu.Item onSelect={() => action({ kind: 'add', ids: [clip.id] }, trigger.current)}>
            <FolderPlus size={16} />
            Zur Sammlung
          </Menu.Item>
          <Menu.Item onSelect={() => action({ kind: 'rename', id: clip.id }, trigger.current)}>
            <Pencil size={16} />
            Umbenennen
          </Menu.Item>
          <Menu.Item onSelect={() => action({ kind: 'share', id: clip.id }, trigger.current)}>
            <Share2 size={16} />
            Teilen
          </Menu.Item>
          {(clip.server || (clip.local && clip.videoSource)) && (
            <Menu.Item asChild>
              <a
                href={clip.server ? `/api/clips/${clip.id}/download` : clip.videoSource}
                download={clip.title}
              >
                <Download size={16} />
                Herunterladen
              </a>
            </Menu.Item>
          )}
          <Menu.Separator />
          <Menu.Item
            className="destructive"
            onSelect={() => action({ kind: 'delete', ids: [clip.id] }, trigger.current)}
          >
            <Trash2 size={16} />
            Löschen
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
