# Run Vegetate on your Windows desktop and iPhone

This is the selected setup: the Windows desktop runs the app and the AI companion; the iPhone connects privately through Tailscale. The desktop must be awake and the companion window must remain open while generating recipes. Saved recipes can be read offline after the app has loaded.

The existing Netlify preview is separate. For ChatGPT-subscription usage, use the desktop's private Tailscale address, not the Netlify URL. No OpenAI API key or separate API billing is required for this route. Requests count toward the ChatGPT plan you authorize, subject to its model, usage and tool limits.

## 1. Prepare the desktop

1. Download the Windows companion ZIP and extract it to a normal folder on your **desktop computer**. It is source code, so keep the included files together.
2. Install [Node.js 24 LTS](https://nodejs.org/en/download) if it is not already installed.
3. Run `Setup-Windows.cmd`. It installs the locked dependencies, builds the web app, and tests Windows credential encryption using synthetic data. It does not sign you in or make AI requests.

If setup reports an error, stop and keep the message for diagnosis. Do not disable antivirus, TLS checks or Windows security controls to make it pass.

## 2. Connect the two devices privately

1. Install [Tailscale](https://tailscale.com/download) on the Windows desktop and iPhone.
2. Sign both devices in to the same Tailscale account and connect them.
3. On the desktop, run `Connect-iPhone.cmd`. It configures private HTTPS forwarding to the companion's phone port. If Tailscale asks you to enable HTTPS for the account, follow its link, then run the command again.

The command uses **Tailscale Serve**, not public Funnel access, and does not open router ports. It refuses to replace an existing, unrelated Serve configuration. If that happens, review the existing configuration before adding Vegetate.

## 3. Start Vegetate and connect ChatGPT

1. Run `Start-Vegetate.cmd` on the Windows desktop. Keep its window open.
2. The desktop browser opens the local setup page. Select **AI connection → Sign in with ChatGPT**.
3. Complete sign-in in that desktop browser and approve ChatGPT-plan usage for Vegetate. Signing in without granting plan usage is not enough to run AI requests.
4. Return to the connection panel. Check the connected account and choose an available model. The model list comes from that account; unsupported models or tools can still produce an error.
5. The panel shows a private iPhone address and a pairing code.

Do not sign in from the phone for the initial connection: OAuth returns to a loopback address on the desktop running the companion. Account sign-in and sign-out are deliberately available only on the desktop setup port.

## 4. Open it on the iPhone

1. With Tailscale connected on the iPhone, open the private HTTPS address shown on the desktop in Safari.
2. Select **AI connection**, enter the desktop pairing code, and select **Unlock AI**.
3. Paste a recipe or recipe link, review the extracted original, and generate both dietary versions.
4. To install it, use **Share → Add to Home Screen**, enable **Open as Web App** if shown, then tap **Add**.

Pairing codes change when the companion restarts. If the phone asks to pair again, enter the new code. Model requests and OAuth credentials stay in the desktop process. Tokens are stored encrypted with Windows DPAPI under the current Windows user's local app-data directory, outside the repository. The phone receives an app session token, never the ChatGPT OAuth tokens.

Use **Manage ChatGPT usage** to view your plan usage. Reaching a usage limit is not resolved by repeatedly reconnecting or retrying. This app does not enable additional credit purchases or change your account's credit settings.

## Saved recipes and existing previews

Recipes are stored in the browser where you save them. Desktop and iPhone notebooks do not automatically sync. To move recipes from the earlier Netlify preview, export them there, then choose **Saved recipes → Import saved recipes** on the private app. Keep an exported backup before removing an old Home Screen app or clearing its data.

## Validation and limits

The cloud environment can build the companion and test its HTTP boundaries, pairing, job ownership, prompt/response handling and the browser flow with simulated ChatGPT responses. It cannot validate Windows DPAPI or the actual desktop/iPhone/Tailscale connection. The setup encryption check and a real recipe request on your devices are still required.

Web research depends on the selected model and the account's tool policy. If research is unavailable, pasted recipe text can still be used, and you can uncheck **Use online research when adapting**. URL extraction requires web access. The app shows an error instead of pretending it read an inaccessible recipe.

The bundled OpenAI Sign-in DevKit uses its **Noncommercial License v1.0**. This setup is for the agreed personal prototype. Review that license and OpenAI eligibility before turning it into a commercial service. The upstream source and notices are preserved under `vendor/siwc-local`.
