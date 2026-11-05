# Let It Snow — External API, Sync & OBS (v3.1.1)

**English** | [Русский](./EXTERNAL_API_RU.md)

Version 3.1.1 lets other programs and pages control the snow at runtime:
sudden bursts, strong wind, specific glyphs, and GIF showers. It can also keep
many windows (in one or several browsers) and OBS in sync.

For step-by-step setup and usage, see the user guide: [English](./USAGE.md) | [Русский](./USAGE_RU.md).

Everything external is **off by default** and is controlled from the popup:
**Settings → API**.

## Commands

Every command uses the same JSON shape:

```json
{ "command": "burst", "params": { "count": 400 }, "id": "optional-request-id" }
```

Every hop (page API, background, relay, OBS overlay, content script) validates commands
again. Unknown fields are dropped, numbers are clamped, and strings, colors and URLs are checked
against allowlists. Effects run on temporary layers on top of the main snow. At most
4 layers run at once; extra requests return `effect_limit_reached` without deleting
existing particles. `burst` and `glyphs` emit exactly `count` particles once, without
respawning, and end only after the last particle falls past the bottom. Their
`durationMs` remains accepted for compatibility but is ignored. GIF layers still fade on expiry.

| Command        | Params (default → range)                                                                                                                                                                 |
|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ping`         | —                                                                                                                                                                                        |
| `start`        | `config`: `snowmax` (1–320), `sinkspeed` (0.1–3), `snowminsize`/`snowmaxsize` (2–10), `colors` (≤12 `#hex`), `symbols` (≤16), `glyphMode` (`text`/`emoji`), `rendererMode` (`auto`/`3d`), `windEnabled`, `windDirection`, `windStrength` (0–3), `windGustFrequency` (0.5–10). Missing values come from saved settings. |
| `stop`         | — (stops the main snow and all effects)                                                                                                                                                  |
| `burst`        | `count` 250 → 1–600, `durationMs` 6000, `speed` 1.6 → 0.1–6, `symbols`, `colors`, `entry` `instant`/`top` (default `instant`: the whole burst enters from the top as one dense wave; `top` trickles in) |
| `wind`         | `enabled` true, `direction` `left`/`right`/`random`, `strength` 1.6 → 0–3, `gustFrequency` 5 → 0.5–10, `durationMs` 8000 (`0` = until the next `wind` command)                              |
| `glyphs`       | **`symbols`** (required, ≤16 symbols, ≤16 code points each), `glyphMode` `text`/`emoji`, `colors`, `count` 60 → 1–300, `durationMs` 10000, `speed` 0.8, `entry` `top`                       |
| `gif`          | **`urls`** (or `url`, ≤5): `https://` with hostname filtering (no common private/loopback addresses or local names, no credentials, port 443 only), or `data:image/(gif\|png\|webp\|apng);base64`. `count` 12 → 1–60, `durationMs` 10000, `speed` 0.8, `entry` `top` |
| `clearEffects` | — (removes all temporary layers and restores the wind)                                                                                                                                 |

### Controls added in 3.1.1

- `burst` also accepts **both** `x` and `y` (finite numbers, viewport CSS pixels from the top-left, clamped to the viewport).
  With coordinates, new particles spawn at that point with radial impulses; `entry` is ignored.
  Self-collisions are disabled for coordinate bursts so coincident particles can expand naturally; wind/pointer interaction remains.
  `symbols` chooses the particles; `glyphMode: "emoji"` preserves emoji rendering.
- `status`: returns `{ok, running, paused, main, effects}`. `main` is `null` or
  `{paused, particles, settled, accumulationEnabled}`; `effects` contains these fields plus each layer's `id`.
- `pause` / `resume`: control the main snow and all effects, including newly created layers.
  Explicit pause is not cleared by switching tabs; resume waits while the page is hidden.
- `update`: `{config: {...}}` changes the **main layer** without restarting or resetting particles.
  Allowed fields: `sinkspeed` (0.1–3), `mouseRadius` (0–300), `accumulationEnabled` (boolean),
  `windEnabled`, `windDirection`, `windStrength`, `windGustFrequency` (same ranges as `start`).
  Empty/unsupported-only updates return `live_config_required`; no main snow returns `not_running`.
  An active `wind` override takes precedence until it expires or is cleared.
  Visual/count changes still use `start`. Updates are session-only, not saved popup settings.
- `start.config` also accepts `mouseRadius` and `accumulationEnabled`.
- `clearAccumulation`: sheds settled particles on **all layers**, without deleting them or stopping the snow.

```json
{"command":"burst","params":{"x":400,"y":250,"count":80,"symbols":["🎉","⭐"],"glyphMode":"emoji"}}
{"command":"update","params":{"config":{"sinkspeed":1.2,"accumulationEnabled":false}}}
{"command":"status"}
```

Accumulation is enabled by default. The shared DOM analysis checks up to 2,000 elements
and 80 visible surfaces per scan (cached for 750 ms). Emoji sized 4–48 CSS pixels
can rest in supported rows **above** cards, images and structural blocks, only where
the landing strip has no detected text, media or controls. The global limit is 32 settled
particles across all layers, with spacing to avoid overlaps. Overlays remain pointer-transparent.
There is **no detachment timer**. An incoming flake can replace a settled particle only with
enough impact speed (at least 100 CSS px/s along the contact normal) and energy:
`(incomingSize / settledSize)^2 * (speed^2 + 2 * positiveAcceleration * incomingSize) >= 160^2`.
Weak impacts bounce/roll off and can fall into a nearby free slot; particles are never
teleported or pulled to slot coordinates. Settling requires physically crossing the support height.
If the first row is full nearby, a direct contact can form a second row. A supported flake
that cannot fall or roll for 0.3 seconds joins the pile even on higher rows, without moving
to another position. Every landing strip is checked for information and the viewport top boundary.
Contacts with the settled pile are swept
along the particle's trajectory (including side impacts), before moving-particle collisions.
Removing a lower supporting flake also releases particles resting on it.
Rest detection uses final collision-resolved positions and tolerates bounded contact jitter.
Shed particles pass through piles rather than getting trapped without permission to reattach.
A resting particle that cannot join safely or exceeds the density limit is released to fall.
Wind influences incoming velocity/acceleration and the settled row: weak gusts leave it intact,
while sustained strong gusts overcome adhesion and release particles in the wind direction.
The wind response includes lift/turbulence, particle size and frame-rate-independent damping.
Scrolling (including nested containers) sheds the row immediately.
Mouse movement also knocks settled flakes loose within `mouseRadius`, including fast sweeps.
Left/right click effects release them within the existing expanded burst radius; a stationary
pointer does not shed flakes, and `mouseRadius: 0` disables pointer shedding.
Particles follow their support during layout changes. Removing the support or covering the
landing strip with information releases particles for safety; explicit `clearAccumulation`
and disabling accumulation also shed them. No landing occurs during scrolling
or for 350 ms afterwards. GIFs and sentences do not accumulate; iframe/shadow DOM internals are not scanned.

`durationMs` for GIF/wind is limited to 500–120000 ms, except that `wind` accepts `0` for a
permanent override. A command payload can be at most 32 KiB.

Possible errors include `unknown_command`, `invalid_params`, `invalid_id`, `symbols_required`,
`valid_https_urls_required`, `invalid_coordinates`, `effect_limit_reached`, `live_config_required`,
`not_running`, `rate_limited`, `payload_too_large` and `page_api_disabled`.

## 1. Popup quick actions & multi-window sync

- **Burst / Storm / Clear effects** buttons send commands to the current tab.
- **Sync all windows**: Start/Stop and API commands go to every open tab in every
  window of this browser, not just the active tab.
- To sync **two different browsers** (for example Chrome and Firefox), enable the relay connection
  in both (see below) with the same relay URL and token. A command sent from either one, or over HTTP,
  reaches all of them.
- Sync broadcasts commands, not identical flake positions or every visual setting. Commands
  received through the relay target all scriptable tabs, independently of the popup sync toggle.
- Quick actions report an unavailable relay or a lack of targets; if a relay send fails after
  local delivery, the popup still shows how many tabs received the command.

## 2. Local relay (HTTP / WebSocket)

The relay is a small zero-dependency Node.js server. It only listens on loopback.

```bash
pnpm build          # also builds dist/obs (or: pnpm build:obs)
pnpm relay          # prints URLs + a generated token
pnpm relay -- --port 8787 --token "<at least 24 chars>"
# or: SNOW_RELAY_TOKEN=... pnpm relay
```

Options: `--port`, `--host` (loopback only), `--token`, `--token-file <path>`, `--allow-origin <origin>` (repeatable),
`--allow-file-origin`, `--static-dir`, `--pid-file <path>`, `--parent-pid <pid>` (exit when that process exits),
`--quiet`, `--version`.

### Standalone relay (no Node.js / pnpm)

Releases ship `let-it-snow-relay-<windows|macos|linux>-<arch>.zip`: a single executable
(Node.js SEA with the OBS overlay embedded), the OBS script `let-it-snow-relay.lua` and a README.
Build locally with `pnpm build:relay` (requires Node.js ≥ 25.5; SEA cannot cross-compile, so CI builds
each OS on its own runner).

- Double-click the executable: without `--token` it reads/creates a persistent token in
  `%APPDATA%\LetItSnow\relay-token.txt` (Windows), `~/Library/Application Support/LetItSnow/relay-token.txt`
  (macOS) or `$XDG_CONFIG_HOME/let-it-snow/relay-token.txt` (Linux), file mode `0600`.
- OBS: *Tools → Scripts → +* → `let-it-snow-relay.lua` (keep it next to the executable). The script starts the relay
  with OBS (`--parent-pid`, token passed via `SNOW_RELAY_TOKEN`, never on the command line), stops it on exit,
  and *Add / update browser source* creates the overlay source in the current scene.

Connect the extension: **API → Relay**. Turn on *Connect to relay*, keep
`ws://127.0.0.1:8787/ws`, then paste the token (or click *Generate* and start the relay with that token).
The status line shows the connection state and the peer count.
It also displays relay send or tab-delivery errors while the connection remains open.

### HTTP

```bash
curl -X POST http://127.0.0.1:8787/api/command \
  -H "Authorization: Bearer $SNOW_RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"burst","params":{"count":500,"durationMs":8000}}'
# → 202 {"ok":true,"delivered":2,"id":null}
```

Responses:
- `401`: bad token.
- `403`: origin not allowed.
- `413`: payload larger than 32 KB.
- `415`: not JSON.
- `429`: rate limited (60 commands per 10 s).
- `400`: validation error.

`GET /health` returns `{"ok":true,"service":"let-it-snow-relay"}` without the token.
`delivered` counts connected relay clients, not tabs or confirmed visual effects.

### WebSocket (`/ws`)

1. Within 5 s, send `{"type":"auth","token":"…","client":{"kind":"client","name":"my-bot"}}`.
   A wrong token closes the socket with code `4401`.
2. The relay answers `{"type":"auth_ok","clientId":"…","peers":N}` and later `{"type":"peers","peers":N}` messages.
3. Send `{"type":"command","command":"wind","params":{"strength":3}}`. The relay forwards it to every
   other authenticated client as `{"type":"command",…,"from":"client"}`.
4. Send `{"type":"ping"}` to get `{"type":"pong"}` back. Idle connections are closed after 90 s.

Limits: 32 clients and 30 commands per 10 s per client.

## 3. Page API (opt-in, per origin)

A web page you trust (for example your own stream dashboard) can control the snow in its own tab
through `window.postMessage`. In the popup, turn on **Page API** and list the exact allowed origins,
one per line (for example `https://my-dashboard.example`). `*` and `null` are rejected.

```js
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.target === 'let-it-snow-api-response') {
    console.log(event.data); // { ok, error?, id, target }
  }
});

window.postMessage({
  target: 'let-it-snow-api',
  id: 'req-1',
  command: 'glyphs',
  params: { symbols: ['🎉', '✨'], glyphMode: 'emoji', count: 80 }
}, window.location.origin);
```

Page commands only affect the current tab. They are never broadcast to other tabs or the relay.
They are limited to 20 per 10 s. GIF URLs from a page load with the page's own permissions; the
extension does not fetch them through its background, so CORS is never bypassed.

## 4. OBS Browser Source

1. Run `pnpm build` (or `pnpm build:obs`) and start `pnpm relay`.
2. In the popup, click **Copy OBS URL**, or build the URL by hand:
   `http://127.0.0.1:8787/obs/?snowmax=120&renderer=3d#token=<token>`
3. In OBS, add a **Browser Source** with that URL and the canvas size. The background is transparent,
   so no custom CSS is needed.

Query parameters:
- `snowmax`, `speed`, `minsize`, `maxsize`
- `colors` (comma-separated, URL-encoded `#`), `symbols`, `glyphMode`
- `renderer` (`auto`/`3d`)
- `wind`, `windDirection`, `windStrength`
- `relay` (custom loopback ws URL), `name`
- `snow=0` (effects only, no base snow), `status=0` (hide the connection badge)

The token goes in the URL **hash** (`#token=`), which is not sent in the HTTP request.
The relay prints the token at startup, and OBS stores the complete URL in its source
settings; keep both private. The overlay pauses when OBS hides the source and retries
a disconnected relay with backoff.

## Security model

- **Opt-in**: the relay, the page API and window sync are all off by default.
- **Loopback only**: the relay binds to `127.0.0.1`/`::1`/`localhost` and rejects other `Host` headers
  (DNS-rebinding protection, `421`). The extension only connects to loopback `ws://`/`wss://` URLs.
- **Authentication**: a shared token (≥24 chars) compared in constant time. HTTP requests must also
  send `Content-Type: application/json`, which blocks simple cross-site form posts.
- **Origins**: browser requests are only accepted from extension origins, the relay's own origin,
  or `--allow-origin` entries. The relay sends no CORS headers.
- **Validation**: strict schema, clamped numbers, sanitized glyphs (no control or bidi characters),
  color allowlist, HTTPS image URL filtering, payload size limits, and rate limits at every hop.
- **Extension messaging**: dispatch, sync and relay messages are accepted only from the extension's
  own pages. Content scripts ignore `snowCommand` messages from other senders.
- **GIF fetch hardening**: background fetches allow `http(s)`, reject non-image content types when
  provided, and stop reading after 15 MiB. A failed background fetch can fall back to a direct browser
  image load, which is not subject to that size limit. URL hostname checks do not verify DNS results
  or redirect destinations; only use trusted image sources and share the token only with trusted
  controllers.
- **OBS page**: served with a strict CSP; static file serving is protected against path traversal.
- The extension stores its token in `chrome.storage.local`, not synced storage. The relay
  prints it at startup, and an OBS source URL also contains it. User-specified remote
  images are requested from their respective servers.
