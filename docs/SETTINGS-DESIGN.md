# Settings design system

How every settings and configuration screen in ReplayHaven is built: the web app's settings
area and the Windows client's settings tab. The goal is one calm, predictable structure instead
of pages that each invent their own boxes, buttons and spacing.

## Problems this replaces

- Cards inside cards: a section card holds status cards, account cards and settings cards, each
  with its own border, radius and padding.
- Controls with no common rule: a switch with an "On/Off" label, a chip ("Client mode"), a
  button or a select, each aligned differently.
- Mixed topics: the account sits in "AI & server", "Devices & server" repeats the Devices page,
  the Devices page mixes a marketing hero, a how-to and live device lists.
- Loose elements: footnotes and links floating under cards, a half-width storage table, an
  always-open "New account" form, an unlabeled delete button.

## Information architecture

One settings area at `/settings/:section` with a navigation of grouped sections. Each section
is its own page (no endless scroll). `/settings` opens the first section on desktop and the
section list on phones. Old routes redirect: `/devices` → `/settings/pcs`, `/users` →
`/settings/users`.

| Group   | Section (slug)            | Who   | Content                                                                       |
| ------- | ------------------------- | ----- | ----------------------------------------------------------------------------- |
| You     | Account (`account`)       | all   | Name shown in the app, password, single sign-on link, sign out                |
|         | Devices (`devices`)       | all   | This account's signed-in browsers and phones, "Connect phone" QR, remove      |
|         | Appearance (`appearance`) | all   | Language, reduce motion, compact library                                      |
|         | Playback (`playback`)     | all   | Default speed, saved progress                                                 |
| Archive | Server (`server`)         | admin | Connection status, analysis options, smooth playback progress                 |
|         | Recording PCs (`pcs`)     | admin | Pairing requests, paired PCs with status (heartbeat), Windows client download |
|         | Users (`users`)           | admin | User list, add user (dialog), roles, disable, reset password, remove          |
|         | Game info (`games`)       | admin | Steam/IGDB fetching status and "Update now"                                   |
|         | Storage (`storage`)       | all   | What the archive and this browser hold; danger zone for resetting local data  |
| Help    | Setup guide (link)        | all   | Links to `/setup`                                                             |

Without a server that knows accounts (local mode), the Archive group shows only Storage and a
single "Connect a server" group; admin-only sections are hidden for users.

## Page anatomy

```
Settings shell
├─ Navigation (desktop: sticky left column 240 px; phone: the section list is its own screen)
└─ Section page (max content width 880 px)
   ├─ Page header: title, one-line description, optional primary action on the right
   ├─ Group (one bordered surface, never nested)
   │  ├─ Group header (optional): title + description, optional action
   │  ├─ Row · Row · Row (hairline dividers)
   │  └─ Group footer (optional): one muted note or callout inside the group
   ├─ Group …
   └─ Danger zone group (optional, always last, red accent, destructive actions only)
```

Rules:

1. **Never nest surfaces.** A group is the only bordered surface. Status, account info and
   lists are rows or a list inside a group.
2. **One row pattern.** Left: label (14/600) and description (13, muted, max 60ch). Right: the
   control, right-aligned, vertically centered. On screens below 640 px the control moves below
   the text, left-aligned, except switches which stay on the right.
3. **Controls:**
   - Switch for immediate on/off settings. No "On/Off" text next to it; the label says what it
     does. Saving is immediate and confirmed by the switch itself.
   - Select or segmented control for a choice of up to six options.
   - Button (secondary) for an action on this row; primary buttons only in page headers,
     dialogs and forms.
   - Status badge (`ok`, `warning`, `error`, `neutral`, `info`) for read-only state.
   - Text fields only in forms (dialogs or an explicit edit mode) with Save/Cancel.
4. **Entity lists** (users, PCs, sessions) use list rows: icon or avatar, title with badges, a
   meta line, and at most one visible secondary action plus an overflow menu (⋯) for the rest.
   Destructive items live in the overflow menu and always confirm in a dialog.
5. **Empty states** inside a group: icon, one sentence, one action.
6. **Notes** belong in the group footer, never floating between groups.
7. **Forms** that create things (new user) open in a dialog, not as an always-open form.

## Tokens (`src/settings.css`)

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48 px (`--s-1` … `--s-8`).
- Radius: group 14 px, controls 10 px, badges 999 px.
- Surfaces: group background `--surface` on the page background, 1 px border `--line`,
  dividers `--line-soft`.
- Type: page title 28/34 600 (display font), group title 15/22 650, row label 14/20 600,
  description 13/19 muted, meta 12/18 subtle.
- Row: min-height 60 px, padding 16 px 20 px, gap 24 px between text and control.
- Focus: 2 px accent outline with 2 px offset on every interactive element.
- Motion: 150 ms ease for hover and switch; none with reduced motion.

## Components (`src/components/settings/`)

`SettingsShell`, `SettingsNav`, `SettingsPage`, `SettingsGroup`, `SettingsRow`, `Switch`,
`SegmentedControl`, `StatusBadge`, `ListRow`, `OverflowMenu`, `EmptyGroup`, `DangerZone`.
Pages compose only these plus existing dialogs and buttons; section-specific CSS is the
exception and lives next to the section.

## Sign-in screens

Sign in, first-account setup, single sign-on and the QR connect page share one split screen in
ReplayHaven's dark theme:

- Left half (product): a deep violet surface with soft light and a faint grid, the logo and
  wordmark at the top, then an eyebrow, a large headline, one sentence on what ReplayHaven does,
  three features with icons (named on your PC, originals on your server, on every device) and a
  decorative sample clip with its AI title at the bottom. Static; nothing moves.
- Right half (form): the card centred in its column, the help line and the footer below.
- Below 1000 px the left half becomes a header above the form (brand, headline, sentence); on
  phones only brand and headline remain, and the card blends into the page.
- Card: 440 px wide, 40–48 px padding, radius 16, one surface, soft shadow. Title 24/32 600
  ("Sign in to your account", "Create your admin account"), no eyebrow chips.
- Fields: label above (14/500), 44 px tall inputs, a helper link aligned right on the label line
  where useful (e.g. "Use a QR code instead" next to Password on phones).
- Errors: one inline alert at the top of the form with an icon, plus the invalid field marked.
- Primary button full width, 44 px. Single sign-on: a full-width secondary button with the
  provider name above a divider "or", when enabled; if password sign-in is off, only that button.
- Below the card: one quiet line of help text (e.g. "Signing in on your phone? Scan the QR code
  under Settings → Devices on a signed-in device.") and a tiny footer with the language switch.
- Loading: the button shows a spinner and keeps its width; fields are disabled while submitting.

## Windows client

The client's settings tab follows the same rules in plain HTML/CSS (`desktop/renderer`): a
left section list (Connection, Recordings, Player names, Local AI, Recognition, Behavior,
Language) and one section at a time on the right, groups with rows, switches without text,
Save/Cancel only where fields are edited. The overview and wizard keep their own layout.

## Accessibility

- Every switch is a `button role="switch"` with `aria-checked` and a visible label.
- Navigation marks the current section with `aria-current="page"`.
- Row controls are labelled by the row label (`aria-labelledby`).
- Dialogs trap focus and return it to the button that opened them.
- Colour is never the only signal: badges carry text.
