# Food data, speed, and recipe sync evaluation

25 October 2026. These are initial findings from the Windows companion using one Italian beef ragù as a test recipe. They are not a broad quality benchmark or a cooking test.

## What is in the app now

- The explanation, tradeoffs, nutrition, ingredient analysis, and sources after a generated recipe are closed panels that can be opened individually.
- Estimated nutrition includes fibre. The app accepts cautious, unsourced values, displays the assumptions, and marks totals as partial when ingredients are omitted.
- With online research switched off, the companion requests lower reasoning effort. The selected ChatGPT model remains under the user's control.
- No food-data service or recipe-sync service is connected yet.

## Timing and quality checks

| Run | Approximate elapsed time | Observation |
| --- | ---: | --- |
| GPT-6.1-Sol with web research | 4 minutes | Detailed seitan and walnut adaptation. Nutrition was unavailable under the previous strict source rule. |
| GPT-6.1-Sol without web research, medium effort | 2m43s | Plausible seitan, lentil, and walnut adaptation. Nutrition unavailable before the estimate instruction was corrected. |
| GPT-6.1-Sol without web research, low effort and best-effort nutrition | 3m17s | Complete estimated macros and fibre for all three versions, including an explicit assumed pasta portion. Vegan recipe used rehydrated soy mince and walnuts, browned separately and added late. |
| GPT-6-Luna without web research, low effort and best-effort nutrition | 2m25s | Plausible lentil and walnut method with the mixture browned and added late. It omitted the unspecified pasta serving from nutrition, so its values were partial lower bounds. |

These runs are not directly comparable: prompts, model, and reasoning settings changed. The no-web runs still took minutes, so removing web research alone does not meet a substantially faster target. The shorter Luna result also lost nutrition completeness. Keep GPT-6.1-Sol as the default while testing a larger set of recipes. Judge flavour/texture plausibility, instruction completeness, nutrition coverage, and time separately; no AI output has been taste-tested.

## Food-data options

| Source | Useful for | Limitation |
| --- | --- | --- |
| [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) | Generic ingredients and calories, protein, carbohydrate, fat, and fibre. Search and detail endpoints; downloadable datasets. | Requires an API key for production. Search results need careful matching to the prepared form. In a quick test, walnuts and cooked lentils were available, but prepared seitan, tomato passata, and textured soy mince were not clear matches in SR Legacy. |
| [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) | Packaged products, barcodes, ingredients, and label nutrition. | Community-contributed data may be incomplete or inaccurate; rate limits and [ODbL reuse conditions](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/) need handling. |
| [Spoonacular](https://spoonacular.com/food-api/docs) | Recipe search, website extraction, nutrition, and ingredient substitutes. Also documents an MCP interface. | Needs its own key and quota. A substitution result still needs dietary and cooking checks; its speed and quality have not been tested in Vegetate. |
| [Edamam](https://developer.edamam.com/edamam-docs-nutrition-api) | Nutrition analysis from ingredient lines. | Needs its own account/key. Its [recipe search](https://developer.edamam.com/api/faq) may link to third-party recipes without supplying their full instructions. |

The databases can reduce repeated nutrition lookups and give recipe examples, but they do not reliably decide which replacement will preserve a particular dish's structure and cooking behavior. A practical next prototype is: use a cached USDA match for standard foods, a product label or Open Food Facts for named packaged foods, and visibly mark any model-estimated portion or nutrient value. Reject uncertain automatic matches instead of silently using the first search result. Test a dedicated recipe/substitute API only if it improves real dishes enough to justify a second account, quota, and licensing review.

For speed, the most promising engineering change is to make the model generate the two cooking adaptations without large repeated nutrient arrays, then calculate nutrition from cached ingredient matches in a separate pass. This has not yet been implemented or benchmarked. A test set of varied dishes is needed before changing the default research setting or model.

## Sync recommendation

The notebook currently lives in each browser's `localStorage`. The Windows browser and paired iPhone therefore have separate saved recipes. Implement sync in the **web app now** using the Windows companion as the shared notebook, protected by the existing phone pairing token. Store it under the companion's user data directory, keep export/import backups, and cache recipes in each browser for offline reading. Reconcile edits by stable recipe ID and update time; show a conflict rather than silently overwriting two edits. When the PC is off, the phone should show its cached recipes and sync once the PC reconnects.

Google or GitHub accounts are unnecessary for one person's desktop and iPhone when both use this private companion. If Vegetate later needs a hosted service, multiple people, or access while the PC is off, add web sign-in and a hosted database then. That can be built in the web app before any native iPhone app; packaging it as an app is not a prerequisite for account-based sync.
