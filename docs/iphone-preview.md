# Put the prototype on your iPhone

**Current setup:** the user has selected the Windows desktop companion with ChatGPT-subscription usage. Use [the Windows/Tailscale instructions](windows-companion.md) for the working app. The Netlify upload instructions below are retained for frontend previews and the optional API-backed deployment; a static ZIP alone does not include the companion or AI backend.

Netlify is the suggested host for this static prototype. This repository has a `netlify.toml` with the build command, output directory and service-worker update header.

## First preview: upload the prepared build

1. Sign in to your own Netlify account and open [Netlify Drop](https://app.netlify.com/drop).
2. Upload the prepared `vegetate-web.zip`. If the uploader requests a folder, unzip it and drop the resulting folder containing `index.html` and `assets/`. Alternatively, run `npm ci && npm run build` and upload `dist/`.
3. Netlify will provide an HTTPS site address. Open that address in Safari on your iPhone.
4. Tap **Share → Add to Home Screen**, enable **Open as Web App** if shown, and tap **Add**.
5. Open Vegetate from its new Home Screen icon and try the ragù sample. Choose each dietary mode, change portions, save an adaptation and reopen it from the notebook. After the first visit has finished loading, try reopening the app with the phone offline.

Publishing creates a hosted site accessible to people who have its address. Recipes you type and save remain in this browser's storage; this prototype has no backend, accounts, analytics or AI requests. Avoid changing the site's address once you are using the notebook, because browser storage belongs to that address. Export a backup before moving hosts or clearing site data.

The agent has prepared and tested the build but has not published it to Netlify. No hosting account has been connected to the workspace, and there is no live iPhone URL yet.

## Later: automatic deployments

Connect the GitHub repository in Netlify when you want changes to deploy automatically. Keep the base directory at the repository root; the checked-in settings run `npm run build` and publish `dist` using Node 24. Set up automatic publishing only when you are ready for repository updates to change the hosted app.

Do not put an AI provider key in a Netlify frontend environment variable or in this web bundle. A future live provider needs a server-side endpoint and an authentication route that supports the chosen deployment.

## What remains to validate on the phone

Automated tests run in desktop and phone-sized Chromium. These checks are not a substitute for iPhone Safari. Check installation, keyboard behaviour in the ingredient editor, the cooking view, local saving after closing the app, and offline reopening on the actual device. The sample recipe also needs a real cooking test before its flavour or texture can be described as validated.
