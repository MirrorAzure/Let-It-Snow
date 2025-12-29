# Let It Snow - Browser Extension

A beautiful customizable snowfall effect extension for any website.

## Installation & Setup

### Prerequisites
- Node.js 16.x or higher
- pnpm package manager (install with: `npm install -g pnpm`)

### Installation

1. Clone or navigate to the project directory
2. Install dependencies:
```bash
pnpm install
```

## Development

### Build for development
```bash
pnpm run dev
```
This starts the Vite development server.

### Build for production
```bash
pnpm run build
```
This creates an optimized build in the `dist` folder.

### Build and pack
```bash
pnpm run build && pnpm run pack
```

### Playground server
```bash
pnpm run playground
```
Serves the `playground/` page for quickly testing the content script. Load the extension in your browser, open `http://localhost:4177`, and use the controls to start/stop snow, tweak parameters, and flip light/dark backgrounds.

### Load the extension in Chrome

1. Run `pnpm run build` to generate the dist folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `dist` folder from your project

## Project Structure

```
src/
├── manifest.json          # Extension configuration
├── content/
│   └── index.js          # Content script (injected into web pages)
├── popup/
│   ├── popup.html        # Popup UI
│   ├── popup.js          # Popup logic
│   └── popup.css         # Popup styles
├── _locales/
│   ├── en/
│   │   └── messages.json # English translations
│   └── ru/
│       └── messages.json # Russian translations
└── icons/                # Extension icons
```

## Features

- **Customizable snowflakes**: Adjust count, size, and falling speed
- **Color selection**: Choose multiple colors for snowflakes
- **Symbol customization**: Use different characters as snowflakes
- **Settings persistence**: All settings are automatically saved
- **Multi-language support**: English and Russian translations

## Building with Vite

This extension uses Vite with the CRXJS plugin for building Chrome extensions. The configuration automatically:
- Bundles JavaScript modules
- Processes CSS imports
- Handles manifest versioning
- Optimizes assets for production

## Notes

- Icons need to be placed in `src/icons/` directory (16px, 48px, 128px)
- The dist folder is generated during build and should not be committed to git
- Use `pnpm` commands instead of `npm` for consistency

## Browser Support

- Chrome/Chromium-based browsers (Manifest V3)
- Tested on Chrome 90+

## License

See LICENSE file for details
