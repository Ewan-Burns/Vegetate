# AI connection and current validation

The user selected the Windows desktop companion and ChatGPT-subscription route, with Tailscale connecting the iPhone. That implementation is now in `companion/`; see [setup instructions](windows-companion.md). The code has not completed a live model request from the user's Windows desktop. No separately billed API key is configured.

## What the ChatGPT-subscription check found

The [official integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) distinguishes identity sign-in from permission to use a ChatGPT plan. Its usage policy says:

> The ChatGPT plan usage integration described here is available for open-source tools and personal projects that run locally. If you’re building a paid or remotely hosted app, join the waitlist to request access before offering it to users.

The [current help article](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) also describes plan sharing for participating integrations. A personal ChatGPT subscription does not automatically authorize an arbitrary hosted Netlify app to make model calls. Do not copy local OAuth credentials into Netlify or represent an unapproved integration as supported.

Supported paths to choose between:

- Hosted automatic app: use an OpenAI API connection with separate usage billing. This adapter is implemented but remains disabled until configured and authorized.
- Local subscription-backed companion: implemented using a pinned copy of OpenAI's local devkit, Windows DPAPI, and Tailscale Serve. The Windows desktop must run it; actual Windows encryption, account authorization, model/tool eligibility and phone access remain to be tested on the user's devices.
- Manual handoff: copy a structured request into ChatGPT and import its answer. This avoids an API key but is not an automatic in-app integration; the manual transfer interface is not implemented.

## Hosted API adapter

Only enable this after the user chooses the API route. In the Netlify project’s environment-variable settings, set these for the **Functions** scope and the intended deploy context:

- `VEGETATE_OPENAI_API_KEY`: the actual OpenAI API key. Enter it securely in Netlify, never in chat or committed files.
- `VEGETATE_ACCESS_CODE`: an app access code of at least 12 characters. The hosted API requires it before creating model requests; enter it in the app’s AI connection dialog.
- `VEGETATE_MODEL`: optional model name; defaults to `gpt-5.4`, which must be available to the API account and support web search, structured output and background responses.

The optional API frontend contains no model credential. It calls `/api/extract`, `/api/adapt`, `/api/result` and `/api/cancel`; Netlify Functions call the Responses API. Long API generations use background responses and authenticated polling. This applies only to the optional API adapter; the selected subscription companion uses `store:false`, `stream:true`, and locally managed jobs instead, in accordance with the sign-in preview requirements.

## Selected Windows companion

OpenAI's devkit was not published as an npm package when inspected, so `vendor/siwc-local` contains the official local package from commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`. Its Noncommercial License, third-party notices and change notes are included. The auth, OIDC verification, refresh and encrypted-storage implementation is retained. Small documented changes expose allowed web-search/structured-output request options and a completed-response callback.

The desktop opens the browser for OAuth and supplies Windows DPAPI as the required OS-backed credential-encryption provider. It never exposes OAuth tokens to the web UI, phone or Netlify. A separate phone server behind Tailscale requires pairing, and cannot initiate desktop sign-in. Both servers bind to loopback; only the phone server is forwarded through Tailscale. Successful sign-in alone is not sufficient: the SDK must confirm the ChatGPT-plan permission, and a real inference request must complete before live access can be claimed.

Model choices are discovered from the selected account. Web search remains subject to its model and policy. The companion does not use unsupported background mode, persistent Responses storage, `max_output_tokens`, or internal ChatGPT backend endpoints for subscription inference.

Extraction uses the original text, or searches the exact public recipe URL and checks for evidence that it was read. Inaccessible links should fall back to user-pasted text. Adaptation asks for both dietary versions, ingredient-role analysis, research, explicit ingredient and cooking changes, and qualitative macro tradeoffs. The app rejects unexplained changes to untouched ingredients/steps and obvious dietary violations. These checks do not establish cooking quality or guarantee dietary/allergen safety.

Nutrition uses per-ingredient quantities and sourced per-100g figures returned by the model. Totals are calculated in code and withheld when required inputs or retrieved source URLs are missing. These remain estimates: matching a source URL does not independently prove that the model copied its numbers correctly. Real cooking tests and further nutrition verification remain outstanding.

## Verification boundaries

Unit and browser tests exercise the API contract, background-job handling, authorization, validation, preservation rules, error states, saving, and the phone-sized interface. Browser tests use explicit synthetic AI responses. They do **not** prove live model access, real web retrieval, adaptation quality or physical iPhone/Safari behaviour.
