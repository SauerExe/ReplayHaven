/*
 * Streaming UI: home page, library and collections with detail dialog and player. The routes are in
 * App.tsx (library and collections lazy-load LibraryPage and CollectionsPage), main.tsx includes
 * the stylesheet.
 *
 * Details and player hang on `?clip=<id>` and `?play=<id>`; the back button closes them. The header
 * from the design is `StreamingHeaderContainer` and can replace the header in Layout.tsx; if the
 * route sits outside <Layout />, `<StreamingHomeContainer header />` shows it itself. Preview with
 * sample data: `npm run dev`, then /streaming-preview.html.
 */
export {
  ClipLayers,
  StreamingHeaderContainer,
  StreamingHomeContainer,
  useClipLayers,
  useStreamLibrary,
} from './connected';
export { ClipMenu, type ClipMenuProps } from './ClipMenu';
export { GridClipTile, type GridClipTileProps } from './GridTile';
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
