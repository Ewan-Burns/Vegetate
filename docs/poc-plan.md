# Vegetate: iPhone proof of concept

## Purpose

Prove that a recipe someone already wants to cook can become a practical vegetarian or vegan recipe while preserving the original dish's character. The first release is for personal use on an iPhone. Sharing with friends is a later decision.

The functional web flow and Windows desktop companion are implemented: text/link extraction, review, both dietary adaptations, research sources, preservation checks, portion scaling, saved recipes and cooking mode. The interface no longer uses the promotional hero or a canned adaptation as its main workflow. Tests use synthetic model responses; real ChatGPT sign-in, Windows credential encryption, Tailscale/iPhone access and cooking quality remain to be verified on the user's devices.

## Platform direction

The user has chosen a responsive Home Screen web app, with a native iPhone app planned later. For subscription-backed inference, the user selected a Windows desktop companion and Tailscale. The desktop hosts the app privately over HTTPS to the iPhone and performs model requests locally. It must stay running for AI requests; this is separate from the public Netlify preview.

For the later native app, evaluate React Native with Expo and TypeScript. Expo Go can support early device testing; a development build is the next step when native capabilities require it. Signing, distribution, and access to the development server must be verified before promising an installable native build. An iOS simulator or local native build requires a Mac with Xcode; Expo also offers cloud builds.

The recipe data structures, validation, nutrition calculations, and provider interface should remain independent of either UI choice. Do not build both interfaces for the proof of concept.

## First usable flow

1. Paste the original recipe, or load a clearly labelled sample.
2. Review and edit extracted ingredients, quantities, units, servings, and steps. Flag missing information; do not silently invent it.
3. Choose vegetarian or vegan and the desired number of portions.
4. Generate one recommended adaptation, then review the replacements, reasons, tradeoffs, and affected cooking steps.
5. Open a simple cooking view with the full ingredient list and complete numbered instructions. Save the recipe on the device.

Pasted text is the first import method. URL import follows after the full paste-to-cooking flow works. Screenshots, video transcription, social sharing integrations, accounts, and cross-device sync are outside the initial build.

## Adaptation requirements

- Vegetarian mode excludes meat, fish, meat stocks, gelatine, and unsuitable animal-derived ingredients. Dairy must be vegetarian-suitable; flag ambiguous cheeses and products for review.
- Vegan mode also excludes dairy, eggs, honey, and other animal ingredients.
- Assess each animal ingredient's role: flavour, texture, richness, moisture, binding, protein, and cooking behaviour.
- Recommend a dish-specific replacement. The answer may be one ingredient, a mixture, or a separately prepared component.
- Preserve unaffected ingredients and steps. Explain changes to cooking time, liquid, seasoning, and preparation.
- Provide a complete adapted recipe, including any component preparation. Do not leave the user to assemble instructions from a list of substitutions.
- Show one recommendation first. Keep alternatives and detailed explanations available without overwhelming the cooking flow.
- Treat AI output as a proposal. Validate structure and quantities, check dietary suitability, and surface unresolved ingredient questions. Such checks reduce mistakes but do not guarantee suitability.
- Do not present predicted similarity as a taste-tested result, or dietary mode as an allergen-safety guarantee.
- Only show product or supporting-recipe links that have been retrieved and verified. Do not generate plausible-looking URLs.

## Portions and nutrition

Store base quantities and base servings. Recalculate displayed quantities from the base values when servings change, avoiding accumulated rounding errors. Distinguish a recipe's total number of servings from the amount a person plans to eat.

Calculate nutrition from ingredient quantities and identified ingredient or product data. Display totals and per-serving estimates, the source of the data, and missing information. Do not treat an AI-generated macro table as measured nutrition. If dependable nutrition data is unavailable, show an incomplete estimate or omit the total rather than fabricate precision.

Keep these three choices separate:

- **Portions:** scale the recipe's quantities; its approximate nutritional balance stays the same.
- **Match the original:** aim for the original dish's per-serving calories and macros, potentially changing ingredients or proportions.
- **Fit my targets:** aim for the user's own per-serving targets, potentially changing ingredients or proportions.

Implement portion scaling first. Original-versus-adapted nutrition comparison can follow when reliable data is available. Automatic optimisation for original or personal macro targets belongs in a later iteration; target controls must not imply optimisation exists before it does.

## AI connection

Define a provider interface for extraction and adaptation, with structured inputs and outputs. Keep provider-specific authentication and requests outside the recipe model and UI.

Start UI development with explicit sample data so the flow can be tested without credentials. A sample adaptation is not evidence that arbitrary recipes can be adapted. The AI milestone is complete only when a real pasted recipe makes a live request and the result passes validation.

The [OpenAI sign-in guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) was checked. The selected route is a local Windows companion using ChatGPT-plan permission, with the iPhone connecting privately through Tailscale. The code implements the supported local flow, but the user's real Windows sign-in, model access, and phone connection remain to be validated. This is separate from hosting the app's inference on Netlify.

Standard API access is a fallback with separate usage charges; see [OpenAI API pricing](https://developers.openai.com/api/docs/pricing). A hosted API integration should keep provider secrets on a backend, not in a shipped web bundle, mobile app, repository, or browser storage. Authorise spending and hosting separately before enabling them.

Use bounded request sizes, timeouts, schema validation, and clear retry/error states. Send only information needed for the requested operation. Add more providers after the first integration works.

## Implementation stages and acceptance checks

### 1. Interactive cooking flow

Build the import, review, preferences, adaptation, and cooking screens with a slow-cooked beef ragù sample. Make both dietary modes and portion scaling work with clearly labelled sample adaptations. Persist saved recipes locally.

Acceptance: the user can complete the flow on an actual iPhone; quantities scale correctly; saved recipes survive an app restart; and the interface remains usable while cooking. Browser-only tests do not establish iPhone device validation.

### 2. Live extraction and adaptation

Connect one supported AI provider. Accept a new pasted recipe, extract editable structured data, obtain a complete adaptation, and validate the result. Handle missing details, provider failures, and unsupported ingredients without losing the original input.

Acceptance: exercise at least these cases in both modes:

- Slow-cooked beef ragù: consider texture and richness, including a separately prepared component when useful; do not default to a generic one-for-one mince swap.
- Chicken and cream curry: adapt the protein and affected cooking method; retain suitable dairy only where the selected mode allows it.
- A dish using egg as a binder: vegetarian mode may retain the egg; vegan mode needs a functional replacement and appropriate instructions.

Also check hidden ingredients such as stock, fish sauce, gelatine, honey, and cheeses with uncertain rennet. Verify that unaffected parts of each recipe are retained.

### 3. Cooking and nutrition evidence

Cook the ragù adaptation and record actual observations about texture, richness, effort, and taste. Distinguish these observations from AI predictions. Add traceable nutrition estimates and original-versus-adapted comparisons once the ingredient data supports them.

Acceptance: complete cooking instructions work in practice, nutrition arithmetic uses identified inputs, and missing data and practical tradeoffs remain visible.

### 4. Expand after the core works

Add recipe URL import with user review, then consider macro targeting, product search, screenshots, and sharing. Import failures and website restrictions should fall back to pasted text. Treat imported content as data, not instructions for the AI or server.

## Decisions to resolve

- Run the selected Windows companion and test its private Tailscale HTTPS address on a real iPhone. The Netlify URL is a separate preview. Home Screen web app first, native iPhone app later remains the agreed direction.
- Verify the user's ChatGPT account grants plan usage and the chosen model supports the required requests; do not enable additional paid API usage or credit purchases.
- Whether a later release should be personal-only or accessible to friends.
- How strongly later optimisation should prioritise resemblance to the original against personal macro targets. For the first build, prioritise a convincing, usable version of the original dish.

No deployment, paid service, external sharing, or subscription eligibility is established by this plan.
