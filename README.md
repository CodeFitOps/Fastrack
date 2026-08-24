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

## Registro de eventos (esquema 2)

Un evento es una entrada independiente con su propia hora: `{ id, at, kind,
sessionId, value?, label?, note? }`. Tipos en `src/core/events.js` — comida,
cetonas, glucosa, peso, agua, entreno, sensación, nota.

Los eventos **no cuelgan de la sesión**. Una comida ocurre por definición fuera
del ayuno; si fueran hijos de una sesión no habría dónde guardarla. Llevan
`sessionId` cuando había un ayuno activo, y `eventsDuring()` los recupera por
ventana temporal, no por ese campo — así aparecen también los fechados hacia
atrás dentro del ayuno.

La hora es editable al registrar. `loggedAt` se anota sólo si difiere en más de
un minuto de `at`, y la UI lo marca como «anotado después»: un valor recordado
tres horas más tarde no merece la misma confianza que uno medido en el momento.

`migrateIfNeeded()` convierte los campos sueltos (kcal/ketones/water/note) de
las sesiones ya guardadas en eventos fechados al cierre del ayuno, marcados
`migrated: true`. Es idempotente y no reescribe las sesiones — sus campos
antiguos quedan intactos por si hubiera que volver a migrar.

## Remaining work

1. Sparkline de cetonas en Stats: los datos ya existen (`series(events,
   'ketones')`), falta dibujarlo.
2. Línea de tiempo del día completo, no sólo del ayuno — es la que enseña el
   patrón real de comidas y entrenos.
3. Editar un evento ya guardado (`editEvent` existe en el hook, sin UI).
4. Drop the three Archivo `.woff2` files into `public/fonts/`.
4. Android: `POST_NOTIFICATIONS` in the manifest, requested at runtime on API
   33+; hardware back button handling; API 35 forces edge-to-edge (handled in
   `app.css`).
5. macOS: Developer ID signing plus notarization, or Gatekeeper blocks launch.
6. **Open question** — fixed phone-width window on macOS, or a responsive
   desktop layout? Decides how much of 1a survives as-is.

## Idiomas (ES / EN)

Sin librería: `src/i18n/` son un catálogo por idioma, una función `t()` con
interpolación y plurales, y un contexto de React. i18next habría costado ~40 kB
de bundle para resolver cuarenta líneas, y esto se empaqueta para móvil.

**Regla del proyecto: ningún texto visible se escribe dentro de un componente.**
Todo pasa por `t()`. Añadir un tercer idioma es copiar `es.js` y traducirlo.

El núcleo tampoco guarda texto: los protocolos, las etapas metabólicas y los
tipos de evento llevan `labelKey`/`noteKey`, no cadenas.

### Lo que se guarda, y por qué importa

Una sensación se almacena como `labelKey: 'mood.hungry'`, no como «Con hambre».
Un registro anotado en español se lee correctamente al cambiar la app a inglés.
El texto libre del usuario (`label`, `note`) se guarda tal cual y no se traduce
nunca — «2 huevos, medio aguacate» es suyo.

### El test que evita el fallo típico

`i18n.test.js` compara los juegos de claves de los dos catálogos y falla si una
existe en uno y no en el otro. Sin él, añadir un texto en español y olvidarlo en
inglés no rompe nada: simplemente sale la clave cruda en pantalla, y sólo se
descubre usando esa pantalla concreta en ese idioma.

El idioma se detecta del navegador (ignorando el país: alguien con el móvil en
inglés viviendo en España quiere la app en inglés), se puede cambiar con el
selector de la cabecera, y se recuerda.

## Copia de seguridad

Los datos viven en el dispositivo y no hay servidor. Eso significa que vaciar el
navegador los borra, y que el navegador y el APK son **almacenamientos
distintos**: instalar la app no trae lo registrado en la web.

El botón `⤓` de la cabecera exporta un JSON e importa uno.

**Importar fusiona, no reemplaza.** Importar en un dispositivo que ya tiene
registros nunca los borra: casi siempre se quiere juntar lo de dos sitios, y un
reemplazo silencioso no se puede deshacer. Ante dos entradas con el mismo id
gana la del dispositivo, porque lo importado se exportó antes y sobrescribir
podría revertir una corrección posterior. Las entradas sin id se deduplican por
contenido, así que importar el mismo fichero dos veces no duplica nada.

El ayuno en curso viaja en la copia — cambiar de dispositivo a mitad de un ayuno
de 20 h y perderlo sería el peor momento posible — pero **nunca pisa uno que ya
esté corriendo** en el destino.

Los timestamps son epoch absolutos, así que una copia hecha en Madrid se importa
bien en cualquier zona horaria: sólo cambia cómo se muestra.

En Android la exportación pasa por el diálogo de compartir del sistema, porque
en un WebView el truco del enlace con Blob puede no hacer nada.
