# Vegetate

An iPhone Home Screen web app for turning existing recipes into vegetarian and vegan versions. The selected setup uses a Windows desktop companion, the user's ChatGPT subscription, and private HTTPS access through Tailscale. The recipe logic remains separate from the web interface for a future native iPhone client.

## Windows desktop + iPhone

Follow [the Windows companion setup](docs/windows-companion.md). Run `Setup-Windows.cmd` once, configure Tailscale with `Connect-iPhone.cmd`, then run `Start-Vegetate.cmd`. Sign in to ChatGPT in the desktop's local setup page and pair the iPhone using the code shown there.

The subscription-powered app runs at the desktop's private Tailscale address. The public Netlify preview is a separate frontend and does not receive ChatGPT OAuth credentials. The desktop needs to remain awake for AI requests; saved recipes can be read offline. Windows DPAPI and the actual sign-in/Tailscale connection require validation on the user's Windows desktop.

## Try the prototype

Use Node.js 22.12 or newer (the cloud environment uses Node 24).

```sh
npm ci
npm run dev
```

Paste recipe text or drop a recipe URL, review the extracted original, then generate **both** vegetarian and vegan versions. The result shows complete instructions, substitution reasons, changes to the cooking method, ingredient-role analysis, macro tradeoffs and research sources. Save the original and both versions together under **Saved recipes**.

The Windows companion and an optional hosted API adapter are implemented. Live ChatGPT account access has not been validated from this cloud machine, and no API key is configured. See [AI connection details](docs/ai-connection.md). Without a connected account, pasted text can still be reviewed and saved, but link extraction and automatic adaptation are unavailable. The app does not substitute a canned recipe for a failed or unavailable AI response. Previously saved sample adaptations remain readable.

The offline text importer expects a title, `Serves N`, an `Ingredients` section and a `Method`, `Directions` or `Instructions` section. The AI extractor handles less structured text and public recipe links once configured. Every extraction needs user review. Screenshots and video import are not implemented. Macro preservation is secondary to taste and texture; precise personal macro optimisation is not implemented.

`npm run dev` starts only the frontend. `npm run companion` starts the selected Windows desktop runtime after a build. The optional Netlify Functions implementation can be developed with `npx --yes netlify-cli@27.14.2 dev`, but it remains disabled without separately configured API credentials.

## Production and iPhone installation

```sh
npm run build
npm run preview
```

The `dist/` directory contains the frontend. The full app also needs the function in `netlify/functions/`; deploy both using the Netlify CLI or a Git-connected build. A ZIP of `dist/` alone does not include the AI backend. `netlify.toml` configures the `/api/*` routes and functions directory. The app is served from the domain root and includes a manifest, Apple touch icon and a versioned service worker. API responses are not stored in its offline cache.

On the iPhone, open the hosted HTTPS address in Safari, choose **Share → Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**. Saved recipes and local text review can work offline after the app has loaded. AI requests always require a connection.

A cloud machine's localhost address is not reachable from your phone. HTTPS hosting and a physical iPhone check remain separate from local browser testing. The cloud environment has not published this app or tested it in iPhone Safari.

Netlify is the suggested first host. Follow [the iPhone preview instructions](docs/iphone-preview.md) to upload the prepared build and install it from Safari. `netlify.toml` also supports a later Git-connected deployment.

Recipes live in this browser's local storage, without accounts or sync. Changing domains, clearing website data, private browsing or removing the installed app can affect that storage. Export your notebook to keep a backup. Reimporting a backup is not yet implemented.

## Checks

```sh
npm test
npm run test:e2e
```

`npm test` exercises the extraction/adaptation API contract, authorization, background generation, preservation and dietary checks, nutrition arithmetic, portion scaling and storage. `test:e2e` tests the browser workflow with explicit synthetic AI responses, including errors, cancellation, both versions, persistence, offline reading and accessibility. These tests do not establish live AI output quality. Phone-sized Chromium is not iOS Safari.

Playwright needs a browser installed locally:

```sh
npx playwright install chromium
```

In the provided cloud environment, reuse the installed browser instead of downloading another:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

For a repeatable cloud dependency refresh, run `bash scripts/setup-cloud.sh`. It installs the locked dependencies, builds the production site and runs the recipe tests. Start a new dev or preview process after restoration; running processes are not part of a saved environment.

## Structure and next steps

- `src/core/`: recipe types, extraction/adaptation schemas, detailed prompts, preservation checks, dietary checks, nutrition arithmetic, API client and storage serialization. A native app can reuse the data and validation code.
- `companion/`: the Windows runtime, encrypted ChatGPT connection, private phone pairing and subscription-backed generation jobs.
- `vendor/siwc-local/`: a pinned copy of OpenAI's local sign-in DevKit with its license, notices and documented modifications.
- `server/api.ts` and `netlify/functions/recipe.ts`: an optional hosted API adapter, disabled without API credentials.
- `src/components/` and `src/App.tsx`: the web interface and cooking flow.
- `scripts/build-worker.mjs`: generates the offline cache from the exact production build.
- `tests/`: full browser workflow and accessibility checks.
- [POC plan](docs/poc-plan.md): scope, acceptance checks and later milestones.

The next milestone is connecting an authorized AI account and testing real recipes end to end, including cooking the results. Do not claim the live workflow works until those checks have run. Keep provider credentials out of the browser bundle and do not move local ChatGPT OAuth credentials to Netlify as a workaround for hosted-app eligibility.
