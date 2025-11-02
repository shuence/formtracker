# Installation Guide

## Quick Start

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/` in Chrome
   - Or go to Chrome menu → Extensions → Manage Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Select the `formtracker` folder (the folder containing `manifest.json`)
   - The extension should now appear in your extensions list

4. **Pin the Extension (Optional)**
   - Click the puzzle icon in Chrome toolbar
   - Find "FormTrack" and click the pin icon to keep it visible

## First Use

1. Once installed, FormTrack automatically starts tracking form submissions
2. Fill out any form on a website and submit it
3. Click the FormTrack icon in your toolbar to view captured submissions

## Troubleshooting

### Extension Not Working

- **Check permissions**: Make sure all permissions are granted
- **Reload extension**: Go to `chrome://extensions/`, find FormTrack, and click the reload icon
- **Check console**: Open Chrome DevTools (F12) and check for errors

### Forms Not Being Captured

- FormTrack automatically ignores login forms and sensitive sites
- Some forms may use AJAX/Fetch - FormTrack should still capture these
- Check if the form has required `name` attributes on inputs (rare issue)

### Icons Missing

- The extension will work without custom icons
- Chrome will use default extension icon
- See `icons/README.md` for icon creation instructions

## Uninstallation

1. Go to `chrome://extensions/`
2. Find "FormTrack"
3. Click "Remove"
4. All stored data will be deleted

## Development Mode

When loaded unpacked, you can:

- Edit files and click reload to see changes
- Use Chrome DevTools for debugging
- Check background service worker logs in Extensions → Service worker link
