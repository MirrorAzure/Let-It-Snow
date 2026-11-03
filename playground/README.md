# Let It Snow Playground

**English** | [Русский](./README_RU.md)

An interactive sandbox for testing the snow animation and previewing the extension UI without installing the extension.

## Quick start

```bash
# Install dependencies
pnpm install

# Start the playground with hot reload (HMR)
pnpm run playground
```

The browser will open at `http://localhost:5173/playground/`

## Available playgrounds

### 🎄 Snow Animation Playground (`index.html`)
Test the snowfall animation with hot reload.

Open: `http://localhost:5173/playground/`

### 🎨 Popup UI Playground (`popup-playground.html`)
Preview and test the look of the extension popup menu with hot reload.

Open: `http://localhost:5173/playground/popup-playground.html`

**🔥 Hot Module Replacement:** Changes in `src/popup/*.css` and `src/popup/*.js` are applied automatically!

## Features

### Snow Animation Playground
- 🎨 **Fully working animation** - uses the extension's source code
- 🔄 **Hot Module Replacement (HMR)** - changes in `src/content/index.js` show up in the browser immediately
- ⚙️ **Every parameter is configurable** - snowflake count, speed, colors, symbols, GIFs
- ❄️ **3D glyphs and colors** - the 3D renderer uses the selected symbols, text/emoji modes and color palette
- 🎯 **No extension install required** - runs as a regular web app
- 🌓 **Theme switching** - light/dark modes for testing the glow logic
- ✨ **Glow comparison** - switch between WebGPU and Canvas2D, set the same minimum glow strength and compare them in the same scene
- 🧊 **3D preview** - switch the renderer to Three.js WebGL2 and test volumetric snow in the same playground
- 🔧 **3D glyph thickness** - adjust the thickness of volumetric snowflakes

### Popup UI Playground
- 👁️ **Popup preview** - the full settings UI in an isolated environment
- 🔥 **Hot Module Replacement (HMR)** - changes in `src/popup/*.css` and `src/popup/*.js` are applied automatically
- 🎮 **Interactive controls** - all sliders, buttons and toggles work
- 🎨 **Adding items** - test adding colors, symbols, sentences and GIFs
- 📱 **Responsive design** - check behavior at different screen sizes
- 🎯 **Full integration** - imports the original styles and modules from `src/popup/`
- 🖱️ **Mouse interactivity** - check how snowflakes react to cursor movement

## How it works

### Snow Animation Playground
1. `playground/content-script.js` - a bridge between the playground and the source code
2. Imports the `SnowWebGPUController` class directly from `src/content/index.js`
3. Any source changes are reloaded in the browser immediately

### Popup UI Playground
1. `playground/popup-playground.js` - imports CSS and JS modules from `src/popup/`
2. Vite watches `src/popup/*` for changes and applies them via HMR
3. CSS changes apply instantly, JS changes trigger a page reload

### Shared infrastructure
1. `playground-server.js` starts the Vite dev server with HMR support for all files
2. `popup-playground.js` - JS module for HMR of popup styles
3. `main.js` - animation control logic in the browser

## Structure

```
playground/
├── index.html              # Snow Animation Playground - UI
├── popup-playground.html   # Popup UI Playground - popup menu preview
├── main.js                 # Animation control logic
├── style.css               # Styles for the snow playground
└── content-script.js       # Bridge to the animation source code
```

## Development

### Developing the snow animation
When building new features in `src/content/index.js`:

1. Run `pnpm run playground`
2. Edit code in `src/content/`
3. The browser reloads automatically with your changes
4. Tune parameters via the playground UI

### Developing the popup UI
When changing the look or logic of the popup menu in `src/popup/`:

1. Run `pnpm run playground`
2. Open `http://localhost:5173/playground/popup-playground.html`
3. Edit code in `src/popup/` (CSS or JS)
4. Changes are applied automatically
5. Tune parameters via the playground UI

## Testing parameters

The playground lets you change in real time:

- **Snowflake count** - from 1 to 400
- **Fall speed** - from 0.05 to 2
- **Minimum glow strength** - from 0 to 1 for comparing the glow in WebGPU and Canvas2D
- **3D glyph thickness** - extrusion depth of the selected symbols in 3D mode
- **Size** - minimum and maximum sizes
- **Colors** - add your own hex colors
- **Symbols** - use any Unicode characters
- **GIF** - add links to GIF files
