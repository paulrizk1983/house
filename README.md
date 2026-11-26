# Our lovely house

Shared expenses app for Grace and Paul. Installable on iPhone and Android from the browser.

- The app is the static files in this folder, served by GitHub Pages.
- Data lives in a private Google Sheet; `config.js` holds the address of the Google script that reads and writes it.
- No expense data is stored in this repository.

## Files
- `index.html`, `app.js`, `app.css`, `sw.js`, `manifest.webmanifest`, icons — the app (GitHub Pages).
- `config.js` — address of the Google Apps Script web app.
- `backend/Code.gs` — copy of the Google Apps Script (the live one runs on script.google.com; redeploy as a New version after changes).
