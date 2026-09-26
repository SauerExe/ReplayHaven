# Product and Design Brief

This brief describes how the ReplayHaven web interface should look, feel and work: product idea, design system, views, states and quality bar. Changes to the interface follow it.

Name: **ReplayHaven**.

The quality target is a streaming interface on par with Netflix: strong image composition, convincing typography, smooth interaction and consistent attention to detail. Develop a distinct identity of its own.

## 1. Assignment

Actually build the application. Do not deliver just a plan or a static concept page.

The first focus is a complete, interactive and visually polished web interface. Implement all core views and their states. Use a cleanly separated demo data layer as long as no backend exists.

Review the existing repository first. Adopt existing frameworks, components and conventions where they fit the goal. Do not start from scratch unnecessarily on an existing project.

Work independently, make consistent product decisions and check the result in the browser whenever the environment allows it.

## 2. Product Idea

ReplayHaven automatically collects gaming clips from the PC and makes them accessible in a private library.

The intended flow:

1. OBS, NVIDIA or Xbox Game Bar save recordings to a local folder.
2. A small desktop application watches selected folders.
3. Fully written files are uploaded to the user's own server.
4. The server processes metadata and thumbnails.
5. Clips appear in the web interface, where they can be watched, organized and shared.

Key product rule:

By default this is an upload archive. If a file is deleted on the PC, the server copy is kept. Automatic deletion of local files is a later, explicitly enabled feature.

The web interface cannot permanently watch arbitrary Windows folders on its own. Present a desktop connection honestly and do not fake this capability.

## 3. Audience and Atmosphere

The application is aimed at gamers who want to keep their highlights and find them again easily:

* competitive clutches;
* funny moments with friends;
* special wins;
* atmospheric game moments;
* short recordings from longer sessions.

The atmosphere is dark, cinematic, high-quality and personal.

The clips are the visual center. Navigation, filters and metadata support them.

Avoid an admin-software aesthetic with stat tiles and tables as the home page. Also avoid: RGB gaming clichés, neon borders, excessive glows, cyberpunk fonts and decorative glassmorphism surfaces.

## 4. Technical Starting Point

If no stack is given:

* React and TypeScript;
* Vite;
* Tailwind CSS;
* React Router;
* Lucide Icons;
* accessible headless components for dialogs and menus;
* CSS animations or an already present motion library;
* a swappable data access layer;
* local persistence for demo settings and user actions.

Make sensible use of existing dependencies. Do not install large libraries for small effects.

The frontend should later be connectable to a self-hostable server. In this phase, do not build your own transcoding infrastructure, a desktop agent or a full authentication system.

## 5. Design System

Use the following palette as the foundation:

| Token               | Color   |
| ------------------- | ------- |
| Background          | #0E1015 |
| Navigation          | #151821 |
| Cards and dialogs   | #1C202B |
| Border              | #2C3241 |
| Primary text        | #F2F3F7 |
| Secondary text      | #9CA5B8 |
| Accent              | #A78BFA |
| Accent hover        | #C4B5FD |
| Success             | #5DD6A4 |
| Error               | #F47C87 |

Primary buttons get a violet background and dark text.

Use violet deliberately:

* most important actions;
* active navigation;
* playback and upload progress;
* selected filters;
* focus states.

Use large dark surfaces with subtle gradation. Borders should only be visible where they improve structure.

Typography:

* a crisp, highly legible sans-serif;
* for example a locally available Geist or Inter;
* large, tightly set hero headings;
* a clear size hierarchy;
* tabular figures for times and file sizes;
* no all-caps text except for small labels.

Styling:

* consistent spacing on a 4/8-pixel grid;
* cards with roughly 10–14 pixel radius;
* dialogs with slightly larger radii;
* mostly compact controls;
* generous spacing between content areas;
* restrained shadows.

Check text contrast and focus styling. Secondary information must remain easy to read.

## 6. Navigation and Page Structure

Desktop:

A full-width navigation bar fixed to the top. Over the hero it is initially transparent with a dark gradient; on scroll it gets a nearly opaque background.

Left:

* a distinct, simple ReplayHaven wordmark;
* a subtle logo mark that also works as an app icon.

Center or next to it:

* Home;
* Library;
* Collections.

Right:

* search;
* upload action;
* compact connection status;
* profile menu with access to devices and settings.

No permanent wide admin panel on the left.

Mobile:

* compact header;
* bottom navigation for Home, Library, Collections and More;
* visible active states;
* enough distance from the bottom screen edge and safe area.

Routes:

* `/`
* `/library`
* `/clips/:id`
* `/collections`
* `/collections/:id`
* `/settings` and `/settings/:section` (old `/devices` and `/users` redirect there)
* `/setup`
* `/share/:token`

## 7. Home Page

The home page is the most important design surface. It must feel like a finished product from the very first visit.

### Hero

A large featured clip forms the entry point.

Desktop:

* roughly 60–72 percent of the viewport height, with a sensible maximum;
* a large gameplay image;
* a dark gradient toward the left for text legibility;
* a soft transition at the bottom into the page background;
* the image's focal point preferably on the right;
* text at the bottom left;
* no extra framed card around the hero.

Hero content:

* a small label such as "YOUR LATEST HIGHLIGHT";
* a punchy clip title;
* game name, recording date, duration and resolution;
* at most one short descriptive sentence;
* primary "Play";
* secondary "Add to collection";
* optionally a restrained details action.

Example (German clip content, glossed):

"Eine Runde. Fünf Treffer." ("One round. Five hits.")

VALORANT · Yesterday · 00:42 · 1440p

Below it: "Der letzte Push hat doch noch funktioniert." ("The last push worked after all.")

If a suitable preview video exists, it may play muted and only under suitable conditions. Respect reduced motion and data saver mode. Otherwise use a high-quality still image.

No automatic rotation between multiple hero slides.

Mobile:

* a more compact hero;
* an adjusted image crop;
* a legible title that does not overlap important controls;
* a clear primary action.

### Content Rows

Below the hero:

1. Recently added.
2. Continue watching – only when there is actual progress.
3. Your games.
4. Favorites.
5. Collections.

Show a few carefully designed items per row. Not every row has to use the same card shape.

"Recently added" and "Favorites" use horizontal video cards.

"Your games" uses larger portrait covers or fitting illustrative game artwork.

Collections use covers composed of several thumbnails.

The next content row should already be visible below the hero at common desktop resolutions.

## 8. Clip Cards

16:9 format.

On the thumbnail:

* duration at the bottom right;
* optionally a subtle favorite icon;
* a progress line along the bottom edge for started clips;
* a status badge only while processing or on error.

Below the image:

* clip title;
* game name;
* relative time.

Titles at most two lines. Prevent layout shifts caused by varying text lengths.

Hover:

* gentle highlight;
* a small play action;
* access to the context menu;
* at most minimal scaling, without covering neighboring cards.

Context menu:

* Play;
* Favorite or Remove favorite;
* Add to collection;
* Rename;
* Share;
* Download, if a file exists;
* Delete.

On touch devices these actions must be reachable without hover.

Hover previews only when real videos exist. Load them lazily and reliably stop them when the pointer leaves the card. Never play multiple previews at the same time.

## 9. Library

The library is a capable, well-organized clip gallery.

Top:

* title "Library";
* actual clip count;
* search;
* upload action.

Filters:

* game;
* favorites;
* time range;
* tags;
* processing status.

Sorting:

* Newest first;
* Oldest first;
* Title;
* Duration;
* File size.

Use compact filter chips and popovers. Active filters must be visible and easy to reset.

Search covers title, game and tags. Search, filters and sorting must work together.

Desktop roughly four to five cards per row, depending on available width. Tablet two to three. Mobile one to two, without unreadable miniature cards.

Multi-select:

* an explicit selection mode;
* mark clips;
* add selected clips to a collection;
* favorite;
* delete after confirmation.

The action bar appears only while a selection is active.

## 10. Clip Detail Page and Player

A dedicated, directly linkable clip view.

The player takes center stage and makes generous use of the available space.

Features:

* play and pause;
* seek bar;
* current time and total duration;
* volume and mute;
* fullscreen;
* playback speed;
* picture-in-picture, where supported.

A well-integrated native player is better than incomplete custom controls.

Keyboard:

* Space for play/pause;
* arrow keys to skip;
* M to mute;
* F for fullscreen;
* Escape to close suitable overlays.

Shortcuts do not fire while the user is typing in an input field. Prevent conflicts with native player functions.

Below the player:

* editable title;
* game and recording date;
* favorite;
* share;
* add to collection;
* more menu;
* tags;
* optional note.

Technical information such as codec, file size and source device belongs in a collapsible details section.

More clips from the same game appear below.

Save playback progress and offer to resume when the clip is reopened. A clip that has been watched almost completely should not stay under "Continue watching" permanently.

Use real player events for progress and error states.

## 11. Collections

Collections are curated groups of the user's own clips.

Examples (user-named, shown as German content with glosses):

* "Clutches";
* "Mit den Jungs" ("With the boys");
* "Komplettes Chaos" ("Complete chaos");
* "Beste Momente 2026" ("Best moments 2026").

Overview:

* large cover cards;
* title;
* number of contained clips;
* last modified.

Detail page:

* cover composition;
* editable title and description;
* the clips it contains;
* add and remove clips.

Create a new collection through a small, accessible dialog. Validate the input.

Collections and favorites must survive a reload.

## 12. Uploads and Devices

Upload status is always reachable through a compact element.

A side view or panel shows:

* current file;
* progress;
* queue;
* successfully completed uploads;
* errors with an understandable cause;
* retry, if implemented.

Manual upload:

* drag and drop;
* file picker;
* understandable format and size checks;
* watch video files locally if no server exists yet.

Label local previews explicitly: "Only available in this browser – not yet saved on the server."

Do not store large video files in localStorage. Revoke object URLs once they are no longer needed.

Devices page:

* connected PCs;
* last contact;
* watched folders;
* upload status;
* mapping of folders to games.

An example folder mapping:

`D:\Clips\Valorant` → VALORANT

If no desktop agent exists, use clearly labeled sample data. Do not show a supposedly working download or pairing process.

Briefly explain the intended flow: install the desktop app, connect the server, choose the recording folder.

## 13. Sharing

A clip can later be reachable through a private link.

Dialog:

* create link;
* choose expiry date;
* copy link;
* revoke link.

Important: a locally stored demo token is not a real public share and not access control.

Without a backend:

* label public sharing as not yet available;
* if needed, offer an explicitly named preview of the share page;
* do not show a false success message about a supposedly externally reachable link.

The share view is minimal:

* subtle branding;
* player;
* title;
* game;
* no navigation into the private library.

## 14. Settings

Clear sections:

* Profile;
* Playback;
* Appearance;
* Storage;
* Devices.

Sensible options:

* automatic muted previews;
* playback speed;
* reduced motion;
* storage information, where available.

Only show settings as operable when they actually have an effect. Server features without integration are clearly shown as not connected.

Storage statistics must be computed from existing data or labeled as demo values.

## 15. Language and Product Copy

The interface is in English.

Write short, concrete copy:

* "Recently added"
* "Continue watching"
* "Your games"
* "Upload clip"
* "Add to collection"
* "No clips yet"
* "No results"
* "Retry upload"

No marketing copy inside the application. No developer terms such as "Mock Provider", "API Adapter" or "Hydration" in the user interface.

A small global "Demo" label is enough for the sample data. On actions with real effects it must additionally be clear what works and what does not have a server connection yet.

## 16. Demo Content and Media

The application must be convincingly populated on first launch.

Create at least:

* 18 distinct clip records;
* five games;
* four collections;
* several favorites;
* three started clips;
* sensible tags;
* varied recording times.

Sample titles (German clip content, glossed):

* "Das war der letzte Schuss" ("That was the last shot")
* "Wir hatten einen Plan" ("We had a plan")
* "1 HP und trotzdem gewonnen" ("1 HP and still won")
* "Niemand hat die Granate gesehen" ("Nobody saw the grenade")
* "Der sauberste Drift bisher" ("The cleanest drift yet")
* "Dieser Boss hatte andere Pläne" ("This boss had other plans")

Use consistent, plausible data. A 30-second clip must not have two minutes of progress.

Media is a decisive part of the design:

* use suitable existing project assets first;
* use legally available sample media with traceable origin;
* no random stock photos of offices, landscapes or people;
* no broken external URLs;
* no identical thumbnail for all clips;
* do not download third-party videos whose usage rights are unclear;
* do not pass off AI images as real gameplay.

If image generation is available, custom illustrative game artwork can be created for demo covers. It does not replace real playable clips.

At least one real playable sample clip should demonstrate the full player flow, provided suitable material is available. Be transparent about missing media in the final summary.

Pick the strongest available image for the hero and adapt the crop, text position and gradient to it.

## 17. Data Model and State

Define typed models for:

* Clip;
* Game;
* Collection;
* Device;
* UploadJob;
* PlaybackProgress;
* UserPreferences.

A clip contains at least:

* ID;
* title;
* game ID;
* thumbnail;
* optional video source;
* duration;
* recording date;
* file size;
* resolution;
* tags;
* favorite status;
* processing status.

Derive lists and counters from a single central data source. Avoid separate, contradictory copies of the same clip on different pages.

Separate:

* UI components;
* pages;
* data access;
* domain models;
* demo content;
* persisted user state.

Persist in the demo:

* favorites;
* title changes;
* collections;
* tags;
* playback progress;
* settings.

Demo data must not overwrite user changes on every render or reload. Offer an explicitly named function in the settings to reset the demo.

## 18. Interactions

Every visible interactive element has an actual function.

Examples:

* A game card opens the library filtered by that game.
* "Show all" opens the matching view.
* Favoriting updates every affected place.
* Search results respond to input.
* A clip card opens the right clip.
* A collection contains the selected clips.
* Context menus are operable.
* Dialogs close with Escape.
* Navigating back preserves filters and scroll position where possible.

No empty click handlers. No success toasts for actions that were not performed.

Destructive actions require a clear confirmation or a reliably working undo.

## 19. States

Also design:

* empty library;
* empty collection;
* no search results;
* missing thumbnail;
* unplayable format;
* missing video file;
* upload error;
* server unreachable;
* processing in progress;
* invalid clip ID;
* unknown route.

Skeletons follow the actual content structure. Do not add artificial delays just to show loading animations.

Error messages explain the problem and name a next action that is actually available.

## 20. Animation and Interaction Quality

Animations support orientation:

* short hover transitions;
* smooth opening of menus and dialogs;
* subtle transitions between views;
* calm progress animations.

Guideline: roughly 120–220 milliseconds for small interactions.

No permanently floating elements, exaggerated bounces or scroll effects that make the interface harder to use.

Respect `prefers-reduced-motion`.

Horizontally scrolling rows:

* support touch and trackpad;
* desktop arrows only when there is overflow;
* no clipped focus rings;
* no unintended horizontal movement of the whole page.

## 21. Responsive Design and Accessibility

Check at least:

* 390 pixels;
* 768 pixels;
* 1440 pixels;
* 1920 pixels.

On small displays:

* reduce navigation;
* move filters into an easy-to-use panel;
* keep important actions visible;
* player without overlapping controls;
* sufficiently large touch targets;
* dialogs may become bottom sheets.

Also:

* semantic buttons and links;
* labeled icon buttons;
* visible keyboard focus;
* correct focus management in dialogs;
* a sensible heading hierarchy;
* status information not conveyed by color alone;
* decorative images without unnecessary screen reader output.

## 22. Performance

* Lazy-load images below the visible area.
* Reserve image space with fixed aspect ratios.
* Do not load full videos for every card.
* Limit video preloading.
* Stop previews that are not visible.
* Use appropriate thumbnail sizes.
* Avoid unnecessary re-renders.
* Load heavy views on demand.
* Keep user state across navigation.

The application should also work structurally with a larger library. Full optimization for hundreds of thousands of clips does not belong in this first phase.

## 23. Visual Quality Control

Judge the actual result in the browser.

Check:

1. Does the first screen feel like a high-quality streaming app?
2. Is the gameplay imagery stronger than the surrounding interface?
3. Is the hero legible and cleanly composed?
4. Is further content already visible?
5. Are spacing, radii and typography consistent across all pages?
6. Are navigation and actions immediately understandable?
7. Do cards feel high-quality without being cluttered?
8. Is the mobile view deliberately designed?
9. Are there overlapping texts, clipped menus or empty image areas?
10. Are demo features honestly labeled?

Fix identified weaknesses before finishing. Do not settle for the application merely rendering technically.

## 24. Verification

Run the existing relevant checks:

* typecheck;
* lint, if set up;
* production build;
* core interaction checks.

Pay special attention to:

* search combined with filters;
* favorites after a reload;
* creating a collection and adding a clip;
* direct navigation to a clip URL;
* player and progress;
* mobile menus;
* local file preview;
* errors for missing media.

Write targeted tests for relevant state logic. Avoid tests that merely mirror markup or implementation details.

If browser checks or obtaining media are not possible, name that specific limitation. Do not claim checks that were not performed.

## 25. Completion

The result should be startable locally and feel like a coherent product.

Deliver:

* the implemented web interface;
* working navigation;
* a high-quality home page;
* a library with search and filters;
* a clip view with player;
* persisted favorites and collections;
* honest upload and device views;
* responsive design;
* a short getting-started guide;
* a brief overview of backend features still missing.

Only publish or deploy the application when explicitly asked to.

Start now by reviewing the project and build ReplayHaven. First prioritize the visual quality of the home page, clip cards and player. Then carry that level consistently over to the remaining views.

## 26. Open-Source Repository, Operations and Division of Work

ReplayHaven is maintained as a public repository. These rules apply to all contributions, including AI agents.

Delivery:

* Server as the Docker image `ghcr.io/<owner>/replayhaven`, multi-architecture (amd64, arm64). Users only need `compose.yaml` and a `.env`; `setup-server.sh` covers setup and building from source.
* Windows client as the NSIS installer `ReplayHaven-Client-Setup.exe` in the GitHub releases. Under "Devices", the server points to a locally stored installer or to `REPLAYHAVEN_CLIENT_DOWNLOAD_URL`.
* A Git tag `vX.Y.Z` triggers the release workflow: installer, image, pinned Compose file, checksums.
* Configuration exclusively via environment variables (`.env.example`). No personal addresses, device names or hardware designations in the code or documentation.

Quality:

* CI checks types, lint, formatting, unit tests, browser tests, the Docker build with a container smoke test, and the unpacked Windows client.
* PolyForm Noncommercial 1.0.0 for the source code (non-commercial use only). Demo media and bundled FFmpeg builds are subject to their own terms (`THIRD-PARTY.md`).
* The repository is in English: interface copy, code, comments, commit messages and developer documentation. Generated clip titles and tags are currently still German product content.

Division of work:

* The web interface under `src/` is designed in a dedicated design pass following sections 3 to 23. Work on the server, client, build, operations and documentation must not redesign the web interface and may only make strictly technical adjustments to it.
* The product rules from section 2 apply without exception: originals stay untouched, capabilities are not faked, and server features without a connection are honestly labeled.
