/*
 * Startseite im Streaming-Stil mit Detaildialog und Player: die Index-Route in App.tsx, das
 * Stylesheet bindet main.tsx ein.
 *
 * Details und Player hängen an `?clip=<id>` und `?play=<id>`, der Zurück-Button schließt sie.
 * Der Kopfbereich aus dem Entwurf ist `StreamingHeaderContainer` und kann den Header in Layout.tsx
 * ersetzen; hängt die Route außerhalb von <Layout />, blendet `<StreamingHomeContainer header />`
 * ihn selbst ein. Vorschau mit Beispieldaten: `npm run dev`, dann /streaming-preview.html.
 */
export { StreamingHeaderContainer, StreamingHomeContainer } from './connected';
export { StreamingHeader, type StreamingHeaderProps } from './StreamingHeader';
export { StreamingHome, type StreamingHomeProps } from './StreamingHome';
export { DetailDialog, type DetailDialogProps } from './DetailDialog';
export { PlayerOverlay, type PlayerOverlayProps } from './PlayerOverlay';
export { Row } from './Row';
export { ClipTile, CollectionTile, ConnectFolderTile, GameTile } from './Tile';
export {
  serverStatus,
  toStreamClip,
  toStreamLibrary,
  type StreamClip,
  type StreamCollection,
  type StreamHighlight,
  type StreamLibrary,
  type StreamStatus,
} from './model';
export {
  buildRows,
  moreFromGame,
  nextClipAfter,
  pickHero,
  type ClipTileData,
  type CollectionTileData,
  type GameTileData,
  type StreamRow,
} from './rows';
