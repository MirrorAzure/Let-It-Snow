# Let It Snow 3.1.1: User Guide

**English** | [Русский](./USAGE_RU.md)

This guide shows how to enable 3D snow, trigger effects, synchronize windows,
and connect OBS or your own program. A detailed description of the command
format and protocol is available in [External API](./EXTERNAL_API.md).

## 1. Quick start and 3D mode

1. Install the extension and open a regular `https://…` page. If the extension
   has just been installed or updated, reload the page.
2. Open the extension → **Settings** → **Snow**.
3. In the **Rendering mode** field, select **3D snowflakes**. Optionally adjust
   the count, size, and **3D glyph thickness**. Colors and symbols are
   configured on the **Symbols** tab.
4. Click **Let it snow!** at the bottom of the window. To stop, click **Stop**.

The glow follows the volumetric silhouette of the snowflake and smoothly pulses
and flickers (each snowflake has its own rhythm). It automatically adapts to a
light or dark page background and changes smoothly when the theme switches — the
background is checked about once per second, so both stylesheet changes and CSS
transitions are picked up.
3D requires WebGL2; if it is unavailable, the extension falls back to Canvas 2D.
On a light background, white snowflakes may be hard to see — choose a more
contrasting color. The background is estimated from the `html` and `body`
colors; background images and individual blocks are not always detected.

3D mode specifics:

- **Emoji** are rendered in their true colors (as in WebGPU) and are not
  recolored by the palette; their glow uses the average color of the emoji.
  Colorfulness is detected from the pixels, so multicolor symbols (e.g. 🦖) keep
  their colors even in "Aa" mode. The symbol mode in the popup is selected
  automatically (🌄, 🦖 → 🙂 emoji); the button next to the symbol lets you
  switch it manually. Symbols like 🌄 in "Aa" mode are drawn with a monochrome
  font and tinted by the palette.
- **Size** of snowflakes matches the settings and the other modes: the size
  sets the symbol's font size, as in Canvas 2D/WebGPU.
- **GIFs** in 3D mode tumble in space like thin plates: their thickness is set
  by the same "3D thickness" slider as for symbols. The tilt is limited so a
  GIF never turns exactly edge-on: the thickness is always visible, the edges
  stay sharp, with no flickering or "big squares". A flickering glow around the
  GIF repeats the colors of its edges; on a light background it weakens. The
  GIF animation is preserved. GIFs have the same glow in WebGPU and Canvas 2D
  modes.
- **Start** — when you click **Let it snow!**, snow starts falling from the top
  in all modes. When auto-starting on a new page, the snowfall continues from
  where it was, so it does not "start over" on every navigation.
- On low-end devices, 3D mode automatically lowers the render resolution if
  the frame rate stays below ~40 FPS for a long time.

### Quick effects

Open **Settings → API → Quick effects**:

- **Snow burst** — immediately adds a temporary layer with a large number of
  snowflakes.
- **Strong wind** — turns on gusty wind for 10 seconds.
- **Clear effects** — removes temporary layers and restores normal wind
  without stopping the main snowfall.

Burst/glyph particles emit once and fall all the way to the bottom; they do not
disappear on a timer or respawn. GIF layers still fade on expiry. At most four layers
are active; a fifth request returns `effect_limit_reached`, preserving existing particles.
An effect with more than 320 snowflakes uses the automatic
2D/WebGPU mode, even if the main snow is running in 3D.

### Emoji accumulation

Ordinary snowfall always starts above the viewport, including autostart and popup previews.
Respawned flakes re-enter from the top; API bursts with explicit coordinates are the exception.

Small emoji can settle above suitable visible cards, images and blocks with free space.
Text, media and controls are checked before landing; the overlay never intercepts clicks.
The pile has a shared density limit of 32 flakes. Settled flakes never detach on a timer:
only a sufficiently energetic impact (speed, acceleration and relative size) replaces one.
Slow flakes bounce/roll off and fall nearby without snapping to a slot; a direct contact can
form a second row if there is no room below. Airborne flakes continue colliding normally.
An almost motionless supported contact lasting 0.3 seconds becomes part of the pile,
including on higher rows, provided it does not cover information or extend above the viewport.
Rolling flakes stay mobile; losing contact resets the check.
Rest is measured from final collision-resolved positions over a small region, so bounded
contact jitter does not restart settling. Shed flakes pass through piles to keep falling;
if a resting flake cannot safely join the pile or the density limit is reached, it is shed too.
Flakes resting between two neighbours use the whole support pocket, not alternating single
contacts; both supports are tracked, and losing either releases the flake.
Landing preserves the current angle and contact height. Weak top contacts lose their bounce,
and rolling starts with gradual acceleration rather than repeated sideways kicks.
Weak wind leaves the pile intact; sustained strong gusts can blow flakes off.
Scrolling (including nested containers) sheds the pile. Flakes follow layout movements;
a removed/unsafe support is cleared.
Moving the mouse across the row also knocks flakes down; left/right clicks retain
their expanded explosion/suction radius. A stationary pointer does not disturb the row.
Large emoji, sentences and GIFs keep falling.
API controls: `clearAccumulation` sheds particles; `update` with
`{"config":{"accumulationEnabled":false}}` disables landing for the main snow.
API `burst` also supports `x`/`y` screen coordinates, while `status`, `pause`, `resume`
and `update` provide runtime control. See the [API reference](./EXTERNAL_API.md#controls-added-in-311).

### Presets

On the **Presets** tab, the preset selected in the list is applied
immediately: the popup settings and the snowfall already running on the
current tab are updated without an "Apply" button. If snow is not running,
selecting a preset does not start it.

Settings changes are no longer written to the preset automatically. A
**"You have unsaved changes"** bar appears (and an orange dot on the tab): the
**Save** button writes the edits to the selected preset. The draft is kept even
if you close the popup.

If you switch presets, import a file, or restore templates while there are
unsaved edits, the popup asks what to do with them:

- **Save as a new preset** — with the specified name;
- **Save to "…"** — to the preset that was selected before;
- **Don't save** — discard the edits;
- **Cancel** — stay on the current preset.

## 2. Synchronizing windows of one browser

1. Open several regular web pages in the tabs or windows you need.
2. In the extension, open **Settings → API** and enable **All tabs and
   windows**.
3. Click **Let it snow!**, **Stop**, or one of the quick effect buttons. The
   command is sent to the available tabs of this browser.

Without the toggle, popup actions in this browser apply only to the active
tab. When a relay is connected, they are also sent to its clients.
Browser system pages and extension stores may forbid script injection; snow
will not appear on them. Hidden tabs pause the animation; a short temporary
effect may end while the tab is hidden.

*Commands* are synchronized, not exact snowflake coordinates: the animations
are generated independently. A temporary effect is not restored when the page
is reloaded.

## 3. Relay: multiple browsers and external programs

The relay is a small local intermediary program. It connects Chrome, Firefox,
Edge, OBS, and external applications **on the same computer**. The relay is
not needed for ordinary synchronization of windows of one browser. The
connection is disabled by default.

### Preparation and launch

There are two ways: a ready-made application (no Node.js or pnpm needed) or
running from source.

#### Option A. Ready-made application (recommended)

1. On the GitHub releases page, download the archive for your system:
   `let-it-snow-relay-windows-x64.zip`, `…-macos-arm64.zip`, `…-macos-x64.zip`
   or `…-linux-x64.zip` — and extract it to a permanent folder.
2. Run `let-it-snow-relay.exe` (macOS/Linux — `let-it-snow-relay`) by
   double-clicking it. A window opens with addresses and a `Token` line; do not
   close it.
3. The token is created once and saved, so you do not need to change it in the
   browsers after a restart:
   - Windows: `%APPDATA%\LetItSnow\relay-token.txt`;
   - macOS: `~/Library/Application Support/LetItSnow/relay-token.txt`;
   - Linux: `~/.config/let-it-snow/relay-token.txt`.

   To change the token, delete this file and restart the relay.

The OBS overlay is already built into the application — there is no need to
build it separately. macOS may block an unsigned program: run
`xattr -d com.apple.quarantine let-it-snow-relay` in the archive folder. On
Linux, run `chmod +x let-it-snow-relay` if needed. The command-line options are
the same as for `pnpm relay` (`--port`, `--token`, `--token-file`, `--help`).

How to start the relay automatically together with OBS is described in the
section ["OBS script"](#obs-script-relay-together-with-obs).

#### Option B. From source

You will need the project source directory, Node.js (versions are listed in
the [README](../README.md#prerequisites)), and pnpm. In a terminal at the
project root:

```powershell
pnpm install       # once after getting the source
pnpm build:obs     # required for OBS; can be skipped if you do not need OBS
pnpm relay
```

Keep the terminal open. The relay shows the WebSocket address, the HTTP API
address, the OBS link, and a `Token` line. Copy the token into the extension
settings. If you do not set the token yourself, it is regenerated on
**every new launch**; update it in the browsers and OBS links.

To keep the same token between launches, you can click **New token** in the
extension, copy the generated value, and set an environment variable in the
same terminal before starting the relay:

```powershell
$env:SNOW_RELAY_TOKEN = '<paste the generated token>'
pnpm relay
```

In bash/zsh it is similar: `export SNOW_RELAY_TOKEN='<token>'`, then
`pnpm relay`. The token must contain 24–256 allowed characters; use a
generated random token, not the examples given in the documentation. You can
stop the relay with `Ctrl+C`.

### Connecting one or more browsers

In **each** browser:

1. Install the extension and open **Settings → API**.
2. In the **Local relay** section, enter the address
   `ws://127.0.0.1:8787/ws` and the same token.
3. Enable **Connect to relay** and make sure the status is **connected**.
4. Open or reload the pages where the effect should appear.

For example, start the relay once and connect Chrome and Firefox to it. Now
starting, stopping, and quick effects from the popup of one browser are passed
through the relay to the other. Incoming relay commands are delivered to all
available tabs of the connected browser; the **All tabs and windows** toggle
also determines the reach of local actions from its popup. OBS and programs
connected to the same relay receive these commands too.

Actions and the supported subset of parameters are synchronized, but not the
full set of visual settings or random trajectories. For an identical look,
configure colors, symbols, and mode in each browser separately, or pass the
supported parameters with the `start` command.

The relay listens only on loopback (`127.0.0.1`, `localhost`, or `::1`) and is
not intended for synchronizing different computers over a network. If you
changed the port, specify it in all addresses and links.

## 4. Connecting OBS

1. Build the overlay with `pnpm build:obs` (not needed for the ready-made
   application) and start the relay as described above, or use the
   [OBS script](#obs-script-relay-together-with-obs). OBS and the relay must
   run on the same computer.
2. Copy the ready `OBS overlay` link from the terminal **or** enter the token
   and address in the extension and click **OBS link**.
3. In OBS, add a **Browser** source (Browser Source) to the scene, paste the
   link into the URL field, and set the width and height, for example
   `1920 × 1080`.
4. Check for the `Connected to relay` label and send a **Snow burst** from a
   connected browser or a command via HTTP.

The overlay background is transparent. Example of setting the count and 3D
mode:

```text
http://127.0.0.1:8787/obs/?snowmax=120&renderer=3d#token=<your-token>
```

Parameters are specified **before** `#token=…` and separated by `&`:

| Parameter | Example | Purpose |
|---|---|---|
| `snowmax` | `120` | Number of regular snowflakes, 1–320. |
| `renderer` | `3d` | `3d` or `auto`; 3D requires WebGL2 in OBS. |
| `speed` | `0.4` | Fall speed, 0.1–3. |
| `minsize`, `maxsize` | `3`, `6` | Sizes as a percentage of the window's shorter side, within 2–10. |
| `colors` | `%23d9f3ff,%23a9d8ff` | Comma-separated colors; `#` must be written as `%23`. |
| `symbols` | `❄,✦` | Comma-separated symbols; URL-encode them if necessary. |
| `glyphMode` | `emoji` | Symbol mode: `text` or `emoji`. |
| `wind`, `windDirection`, `windStrength` | `1`, `right`, `1.5` | Wind; directions `left`, `right`, `random`. |
| `snow` | `0` | Do not start the main snow automatically; effects can be triggered by commands. |
| `status` | `0` | Hide the connection status label. |

For example, add `&status=0` directly before `#token=…`. If the relay
reconnects, the overlay tries to restore the connection. The animation pauses
when the OBS source is hidden or inactive.

### OBS script: relay together with OBS

The ready-made application archive includes `let-it-snow-relay.lua`. It starts
the relay in the background when OBS opens and stops it when OBS closes.

1. Keep `let-it-snow-relay.lua` in the same folder as the executable.
2. In OBS: **Tools → Scripts → "+"** and select `let-it-snow-relay.lua`.
3. Click **Add / update browser source** — a "Let It Snow" source with the
   correct link and canvas size is added to the current scene.
4. Copy the value of the **Token** field into the extension
   (**Settings → API**).

Script settings: autostart, program path, port, mode (`3D` or `Auto`),
additional overlay parameters (for example `snowmax=120&wind=1`), source name.
The **Generate new token** button creates a new token, restarts the relay, and
updates the source. The token is generated by the system's random number
generator and passed to the relay via an environment variable, not on the
command line. If OBS crashes, the relay shuts down on its own.

## 5. Sending commands via HTTP

While the relay is running, open a **second** PowerShell terminal and paste
the token from the first terminal. The function below sends commands to the
default port:

```powershell
$SnowToken = '<paste the relay token>'

function Send-SnowCommand {
    param([string]$Command, [hashtable]$Options = @{})
    $json = @{ command = $Command; params = $Options } |
        ConvertTo-Json -Depth 6 -Compress
    Invoke-RestMethod -Method Post `
        -Uri 'http://127.0.0.1:8787/api/command' `
        -Headers @{ Authorization = "Bearer $SnowToken" } `
        -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($json))
}

Send-SnowCommand 'burst' @{ count = 400; durationMs = 8000; entry = 'instant' }
```

Examples of the other commands in the same terminal:

```powershell
# Gusty wind to the right for 12 seconds
Send-SnowCommand 'wind' @{
    direction = 'right'; strength = 3; gustFrequency = 7; durationMs = 12000
}

# Temporary rain of selected glyphs/emoji
Send-SnowCommand 'glyphs' @{
    symbols = @('🎉', '✨'); glyphMode = 'emoji'
    count = 80; durationMs = 10000; entry = 'instant'
}

# Replace the address with a public HTTPS address of an existing image
Send-SnowCommand 'gif' @{
    urls = @('https://example.com/animation.gif')
    count = 12; durationMs = 10000; entry = 'instant'
}

# Start the main snow; parameters are set inside config
Send-SnowCommand 'start' @{
    config = @{
        snowmax = 100; rendererMode = '3d'
        symbols = @('🎉', '✨'); glyphMode = 'emoji'
        colors = @('#d9f3ff', '#a9d8ff')
    }
}

Send-SnowCommand 'clearEffects'  # remove temporary effects and restore wind
Send-SnowCommand 'stop'          # stop the main snow and effects
```

Usually `entry` takes `instant` or `top`. In both cases snow (including 3D and
GIFs) appears at the top and falls down rather than appearing across the whole
screen at once: with `top` snowflakes fly in gradually, with `instant` the
whole layer starts as a dense wave from a narrow strip above the top edge.
For `wind`, the value `durationMs = 0` keeps the override until the next wind
command or until effects are cleared.

A `202` response means the relay **accepted and forwarded** the command. The
`delivered` field shows the number of connected relay clients, not the number
of tabs and not a confirmation of actual display. If `delivered = 0`, check
the browser or OBS connection.

Other programs can send JSON `{ "command": "...", "params": {...} }`
with the `Authorization: Bearer <token>` and `Content-Type: application/json` headers.
The relay also supports WebSocket `/ws`: after connecting, the first message
must be `{"type":"auth","token":"<token>"}`; wait for `auth_ok` and then send
commands with the `"type":"command"` field. A `{"type":"ping"}` message every
20 seconds keeps the connection alive. A command is sent to the other clients
but not back to the sender. See the [WebSocket format](./EXTERNAL_API.md#websocket-ws)
for details.

## 6. Commands from a trusted website

The website API does not require the relay, but it is disabled by default:

1. In the extension, open **Settings → API → API for websites**.
2. Enable **Allow commands from pages**.
3. In **Allowed sites**, enter the exact origin, for example
   `https://dashboard.example.com`, one per line. An origin includes the
   scheme, domain, and port if needed, but not the path.
4. Go to the allowed site and send a message from its JavaScript:

```js
window.addEventListener('message', (event) => {
  if (event.source === window && event.origin === window.location.origin &&
      event.data?.target === 'let-it-snow-api-response') {
    console.log('Result:', event.data);
  }
});

window.postMessage({
  target: 'let-it-snow-api',
  id: 'my-burst-1',
  command: 'burst',
  params: { count: 250, durationMs: 8000 }
}, window.location.origin);
```

The response contains the same `id` and either `ok: true` or `ok: false` and
`error`. A page command controls only **its own tab** and is not broadcast
through the relay, even when synchronization is enabled.
Allow only sites you trust: any script on an allowed page will be able to
control the effects. `*`, `file://`, and `null` are not accepted.

## 7. Limits, security, and troubleshooting

- A single request is limited to 32 KiB. `burst`: up to 600 snowflakes,
  `glyphs`: up to 300, `gif`: up to 60 images. Effect duration is
  500–120000 ms; the exception is `durationMs = 0` for permanent wind.
  Numbers outside the allowed ranges are clamped to these limits.
- For the `gif` command, use public HTTPS image addresses or small
  `data:image/...;base64` values within the request size limit. For the website
  API and OBS, loading is subject to the page's restrictions, including CSP.
  Images from external addresses are loaded from the corresponding servers.
  URL validation blocks typical local addresses and hostnames, but does not
  guarantee a public DNS result and does not control redirects. Therefore, use
  only trusted image sources and do not give the token to untrusted programs.
  The 15 MiB download limit applies only to downloads through the extension
  background; it does not apply when the browser loads the image directly.
- The token grants control over all connected clients: do not publish it, the
  terminal output, OBS links, or OBS projects containing that link. The link
  stores the token after `#`; this part is not sent in the HTTP request for
  the page, but it is saved in the OBS source settings. The extension token is
  stored in the browser's local storage, not in synced storage.
- **No connection:** check that the relay is running, the address, the port,
  and that the token is the same; after restarting with a new token, update it
  in all clients.
- **Command accepted, but no effect:** check `delivered`, the connection
  status, use a regular web page instead of a system page, reload the page, and
  make sure the tab/OBS source is visible.
- **Relay error on a quick effect:** it may already have been applied locally;
  the popup separately shows the number of tabs that received the command.
- **OBS shows an error instead of the page:** run `pnpm build:obs`, check the
  `/obs/` URL, and make sure the relay is still running.
- **3D is slow:** reduce the number and size of snowflakes or select
  **Auto (2D/WebGPU)** in the rendering settings.
- **Error 401:** invalid token. **400:** check the command format;
  **413:** the request is too large; **429:** reduce the sending rate.
- **Website API does not respond:** check the exact origin and that the
  permission is enabled. An arbitrary website cannot send an HTTP `fetch` to
  the relay as a substitute for the page API: the relay does not provide CORS
  access.

For the full list of commands, parameters, and limits, see
[External API](./EXTERNAL_API.md#commands).

## 8. Chrome Web Store materials

`pnpm build` on a local machine creates the `store-assets/` folder after the
build (this step is skipped in CI). It can be uploaded to the Chrome Web Store
right away:

- `en/` and `ru/` — 5 screenshots each at 1280×800 (24-bit PNG without
  transparency) showing the snowfall and popup in action, a small promo tile
  440×280, and a 1400×560 marquee banner;
- `title.txt`, `summary.txt` (up to 132 characters), `description.txt` (up to
  16,000 characters) with the current version and a "What's new" section,
  `listing.md` — a preview;
- `icon-128.png` and `README.md` with the list of files.

Standalone run: `pnpm store:assets` (requires a finished `dist/` build).
Chrome, Chromium, or Edge must be installed; the path can be set in the
`CHROME_PATH` variable. Without a browser, only the texts are generated. To
skip the step during the build: `SKIP_STORE_ASSETS=1` or
`pnpm build -- --no-store-assets`.
The English "What's new" is taken from `CHANGELOG.md`, the Russian one from
`scripts/store-assets/listing.js` (`WHATS_NEW_RU`); when releasing a new
version, add entries there, otherwise the generator emits a warning.
