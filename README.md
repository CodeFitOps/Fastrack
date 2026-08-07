# Fastrack — packaging

Turning the Claude Design prototype into a macOS and Android app.

```bash
npm install
npm test          # 20 tests, no build needed
npm run build     # verified: builds clean, no network dependencies
```

## What the export actually is

`Fasting App.dc.html` is a **design canvas, not an app**. One 757-line file holding
five options:

| | |
|---|---|
| **1a** | the working prototype — the only one with live state |
| 1b | alternate home as a dial |
| 1c | alternate home as a rhythm grid |
| 1d | alternate dashboard as a data sheet |
| 1e | the same screen on Android chrome |

Packaging means extracting 1a and dropping the rest, along with the canvas
scaffolding (`<x-dc>`, the `.dv-turn` review furniture, the design brief prose).
`ios-frame.jsx` and `android-frame.jsx` go too — they draw device bezels for
previewing in a browser.

## The blocker: support.js

`support.js` is a 1,911-line generated runtime (`dc-runtime`, marked *do not
edit*) that interprets a custom template DSL and mounts it through React:

- `{{ expr }}` bindings
- `<sc-if value="{{ c }}">` / `<sc-for list="{{ xs }}" as="x">`
- `<x-import component-from-global-scope="…">`
- a `class Component extends DCLogic` with a `renderVals()` view-model

None of that is shippable. The port is mechanical but it is the bulk of the
work. `src/ui/TodayScreen.jsx` is the worked reference:

| dc-runtime | React |
|---|---|
| `{{ expr }}` | `{expr}` |
| `<sc-if value="{{ c }}">…</sc-if>` | `{c && (…)}` |
| `<sc-for list="{{ xs }}" as="x">` | `{xs.map(x => (…))}` |
| `renderVals()` returning a flat object | values computed in the component body |
| handlers returned as view-model fields | `onClick` props |

## What's built

| Path | |
|---|---|
| `src/core/fastSession.js` | session logic — pure, timestamp-derived |
| `src/core/protocols.js` | protocols and metabolic stages, with real durations |
| `src/core/*.test.js` | 20 tests |
| `src/ui/useFastTracker.js` | live fast, wired to storage and notifications |
| `src/ui/TodayScreen.jsx` | screen 1a ported off the runtime |
| `src/platform/storage.js` | persistence — one async API, four backends |
| `src/platform/notifications.js` | goal alerts scheduled at an absolute time |
| `src/ds/` | the Modernist stylesheet, with fonts self-hosted |
| `src/styles/app.css` | safe-area insets and WebView quirks |

## Bugs found in the prototype

**Protocol targets are parsed from display strings.** `parseInt(p.hours, 10)`
against `'—'` returns `NaN`, so picking FREE-FORM silently starts a **16-hour**
target — on the one protocol defined by having no target. `'24H+'` parses to a
flat `24`, dropping EXTENDED's 24–72h staging. Fixed in `protocols.js`, where
durations are declared as numbers and display strings are display only.

**No persistence.** State is entirely in memory: `history` is seeded fixtures and
`start` is a hardcoded `Date.now() - 14h`. Closing the app loses a running fast.

**Dates are string literals.** `'TUE 04 AUG'` is hardcoded in three places.

**Inline hex and px throughout**, which the project's own
`_adherence.oxlintrc.json` flags — *"Raw hex color — use a design-system color
token via var()"*. The tokens already exist in `styles.css`; the port uses them.

**The stylesheet pulled Archivo from Google Fonts over the network.** Fatal for a
packaged app: offline it silently falls back to system-ui. Now self-hosted; drop
the `.woff2` files into `public/fonts/` (see the README there).

## What the prototype got right

The timer is already derived correctly — `el = (st.now - st.start) / 1000` reads
from timestamps rather than accumulating ticks, so backgrounding does not drift
it. The `now` interval only drives repaints. `useFastTracker` keeps that and adds
a resync on `visibilitychange` and `focus`, because a suspended WebView throttles
timers and the clock would otherwise show a stale value on return.

## Choosing a shell

**Capacitor + Electron** is now the recommendation, over Tauri for both.
`LocalNotifications.schedule()` fires at an absolute future time through the OS,
which is what a "fast complete" alert needs — the app will not be running when it
fires. Tauri's notification plugin can only fire immediately, so Android alerts
would need a native alarm written by hand.

Tauri is still the better pick if background alerts do not matter: one toolchain
for both targets and a ~5 MB binary against Electron's ~100 MB. `storage.js` and
`notifications.js` are the only files that change either way.

## Remaining work

1. Port the History and Stats tabs, and the start/log sheets (same table above).
2. Real dates replacing the hardcoded strings.
3. Migrate seeded history fixtures out of state.
4. Android: `POST_NOTIFICATIONS` in the manifest, requested at runtime on API
   33+; hardware back button handling; API 35 forces edge-to-edge (handled in
   `app.css`).
5. macOS: Developer ID signing plus notarization, or Gatekeeper blocks launch.
6. **Open question** — fixed phone-width window on macOS, or a responsive
   desktop layout? Decides how much of 1a survives as-is.
