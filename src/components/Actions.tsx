import { createContext, useContext, useState } from 'react';
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
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useVault } from '../data/store';
import { createSeed } from '../data/seed';
import type { Clip } from '../domain/models';
type Action =
  | { kind: 'add' | 'delete'; ids: string[] }
  | { kind: 'rename' | 'share' | 'tags'; id: string }
  | { kind: 'create' | 'upload' }
  | { kind: 'editCollection' | 'deleteCollection' | 'addClips'; id: string }
  | { kind: 'reset' };
const ActionsContext = createContext<(action: Action) => void>(() => {});
export const useActions = () => useContext(ActionsContext);
export function ActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<Action | null>(null);
  return (
    <ActionsContext.Provider value={setAction}>
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
          />
        )}
      </Dialog.Root>
    </ActionsContext.Provider>
  );
}
function ActionDialog({ action, close }: { action: Action; close: () => void }) {
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
            picked.includes(c.id)
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
                  clipIds: [...new Set([...c.clipIds, ...picked])],
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
  const selectable =
    action.kind === 'add'
      ? state.collections
      : action.kind === 'addClips'
        ? state.clips.filter((c) => !collection?.clipIds.includes(c.id))
        : [];
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className={`dialog ${action.kind === 'upload' ? 'upload-dialog' : ''}`}>
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">DEIN REPLAYHAVEN</span>
            <Dialog.Title>{titles[action.kind]}</Dialog.Title>
          </div>
          <Dialog.Close className="icon-button" aria-label="Dialog schließen">
            <X size={21} />
          </Dialog.Close>
        </div>
        <Dialog.Description className="muted dialog-description">
          {action.kind === 'upload'
            ? 'Deine Aufnahmen. Ein Ort.'
            : action.kind === 'share'
              ? 'Öffentliche Freigaben benötigen einen verbundenen Server.'
              : action.kind === 'delete'
                ? 'Die ausgewählten Einträge werden aus der Bibliothek und allen Sammlungen entfernt. Originaldateien bleiben erhalten.'
                : action.kind === 'deleteCollection'
                  ? 'Die Sammlung wird entfernt. Deine Clips bleiben in der Bibliothek.'
                  : action.kind === 'reset'
                    ? 'Titel, Favoriten, Sammlungen und Einstellungen werden zurückgesetzt. Lokale Vorschauen werden entfernt.'
                    : 'Mach dein Archiv zu deinem.'}
        </Dialog.Description>
        {['rename', 'tags', 'create', 'editCollection'].includes(action.kind) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
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
                Beschreibung <span className="muted">(optional)</span>
                <textarea
                  value={description}
                  maxLength={400}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Was gehört hier rein?"
                />
              </label>
            )}
            <div className="dialog-footer">
              <button type="button" className="button secondary" onClick={close}>
                Abbrechen
              </button>
              <button className="button primary" disabled={action.kind !== 'tags' && !value.trim()}>
                {action.kind === 'create' ? 'Sammlung erstellen' : 'Speichern'}
              </button>
            </div>
          </form>
        )}
        {(action.kind === 'add' || action.kind === 'addClips') && (
          <>
            <div className="selection-list">
              {selectable.length === 0 ? (
                <p className="muted">
                  {action.kind === 'add'
                    ? 'Erstelle zuerst unter „Sammlungen“ eine Sammlung.'
                    : 'Alle verfügbaren Clips sind bereits in dieser Sammlung.'}
                </p>
              ) : (
                selectable.map((item) => (
                  <label key={item.id} className="selection-option">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, item.id] : p.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>{item.title}</span>
                    {'clipIds' in item && <small>{item.clipIds.length} Clips</small>}
                  </label>
                ))
              )}
            </div>
            <div className="dialog-footer">
              <button className="button secondary" onClick={close}>
                Abbrechen
              </button>
              <button className="button primary" onClick={save} disabled={!picked.length}>
                <FolderPlus size={17} />
                Hinzufügen
              </button>
            </div>
          </>
        )}
        {['delete', 'deleteCollection'].includes(action.kind) && (
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
              <span className="eyebrow">LOKALE VORSCHAU</span>
              <p>{clip.title}</p>
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
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void importFiles([...e.dataTransfer.files], localOnly);
              }}
            >
              <UploadCloud size={38} strokeWidth={1.4} />
              <h3>Gute Momente gehören hierher.</h3>
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
              <small>MP4, WebM, MOV · Max. 2 GB pro Datei</small>
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
                    <progress max={100} value={job.progress} />
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
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="icon-button clip-menu" aria-label={`Aktionen für ${clip.title}`}>
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
          <Menu.Item onSelect={() => action({ kind: 'add', ids: [clip.id] })}>
            <FolderPlus size={16} />
            Zur Sammlung
          </Menu.Item>
          <Menu.Item onSelect={() => action({ kind: 'rename', id: clip.id })}>
            <Pencil size={16} />
            Umbenennen
          </Menu.Item>
          <Menu.Item onSelect={() => action({ kind: 'share', id: clip.id })}>
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
            onSelect={() => action({ kind: 'delete', ids: [clip.id] })}
          >
            <Trash2 size={16} />
            Löschen
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
