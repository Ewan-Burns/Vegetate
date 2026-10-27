# Food-data API prototype

Updated 27 October 2026. Food database mode separates cooking generation from nutrition calculation. The model proposes ingredient replacements and instruction edits; the backend preserves unchanged content, reconstructs both complete recipes and copies nutrient values from selected USDA records and Open Food Facts product labels. This mode is the default once a USDA key is configured and is available to paired phones as well as the desktop. Broad web research remains a separate choice.

## Why USDA first

[USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) is free to access with an API key. Its data are public domain (CC0), and USDA asks to be credited. The documented default limit is 1,000 requests/hour per IP. The public `DEMO_KEY` supports initial testing but allows only 30 requests/hour and 50/day per IP. For continued testing, set `USDA_FDC_API_KEY` in the companion process environment or in a Git-ignored `.env.local` or `.env` file at the project root. The companion and `food:probe` load these files at startup, with existing process variables taking priority. The key stays on the Windows backend and is never returned to the browser. The prototype caches identical searches in memory for one hour.

Choose **Use food databases** on the recipe review screen. This mode omits repeated numerical nutrient tables from the model response. A catalogue of 54 explicitly selected USDA records covers common ingredients; it is cached with source URLs and a retrieval date. Open Food Facts supplies a separately fetched, explicitly labelled representative seitan product. The backend applies conservative name/preparation matching and calculates totals from ingredient amounts. Unknown foods remain missing rather than being assigned the first search result. Brand substitutions, household-measure conversions and model-supplied edible-weight assumptions are shown in the nutrition notes.

Database coverage describes the source of nutrient values, not proof that the user's product or cooked serving is identical. Even with full database coverage, recipe totals remain estimates. Missing fibre is reported separately; a partial fibre total is marked with ≥. Open Food Facts attribution is included in the source and ingredient notes. Its product data are not bundled into the USDA snapshot.

The route accepts:

```json
{"query":"walnuts","dataTypes":["SR Legacy"],"pageSize":5}
```

It returns `matchPolicy: "review-required"` and candidate records with `fdcId`, description, data type, optional brand, source link, and nullable `per100g` fields. A missing nutrient stays `null`, rather than being treated as zero. Invalid input is rejected before contacting USDA. The route is limited to the local desktop, so a paired phone cannot spend the prototype's small demo quota.

To probe the API from this branch without stopping the currently running companion, use `npm.cmd run food:probe -- walnuts` from the project folder. Add `--branded` to inspect product-specific results. The command prints elapsed time and candidates, never the key. It will report a search-limit error while the shared `DEMO_KEY` is exhausted.

Use `npm.cmd run food:products -- seitan` to test the key-free Open Food Facts search. The authenticated `/api/product-search` route exposes the same reviewable candidates to a paired client. `npm.cmd run food:refresh -- --check` checks all selected USDA IDs without changing the snapshot; omit `--check` to refresh the selected records. See `companion/data/README.md` for data provenance.

Run `npm.cmd run food:benchmark -- my-run` only when you want a live generation comparison: it consumes the connected ChatGPT plan's usage. It saves the synthetic input, full response and timings under `.cache/benchmark-tonkotsu-my-run.json`, without reading or printing account credentials. `--mode web` and `--mode estimate` support comparison runs. The script never runs as part of build or tests.

## First live checks

| Query | API time | Result |
| --- | ---: | --- |
| `walnuts`, SR Legacy/Foundation | 1.7 s | The first hit was **walnut oil**; English walnuts was the second hit (654 kcal, 15.2 g protein, 13.7 g carbs, 65.2 g fat, 6.7 g fibre per 100 g). |
| `lentils cooked`, SR Legacy/Foundation | 1.8 s | Cooked lentils were available, alongside different preparations such as sprouted lentils. |
| `seitan`, SR Legacy/Foundation | 1.3 s | No match. A separate Branded search reported 65 hits, but these represent different products and recipes. |

These are search timings, not full recipe generation timings. The shared `DEMO_KEY` then hit its rate limit; tests use representative responses to verify normalization and endpoint access. A personal free key is needed for sustained live comparisons. Candidate selection still needs review: using the first hit would have made the walnut nutrition wildly wrong.

An initial tonkotsu-style ramen run found a validation false positive for an ingredient explicitly labelled "without fish dashi"; the check and prompt were corrected. A second full adaptation completed in 268 seconds and produced vegetarian and vegan versions, but the exhausted demo quota meant no USDA candidates were used and all nutrition figures were unverified model estimates. This does not establish a speed or accuracy gain for the database mode.

On 27 October 2026, a personal USDA key was verified and stored using Windows encryption. After correcting a prompt that had incorrectly required all source URLs to be null, the same ramen benchmark completed in 247 seconds. Eleven ingredient queries supplied 31 candidates. Each dietary version used three USDA references (garlic, dried shiitake and sake); the remaining nutrition inputs were estimates. Searches for bones, kombu, fresh ramen and ramen eggs returned unsuitable candidates, reinforcing the need to review food and preparation matches. This single run does not establish a speed advantage. An Open Food Facts search again returned HTTP 503.

The next iteration removed model-generated nutrient tables and used the selected catalogue plus the working Open Food Facts API. The same synthetic tonkotsu-style fixture completed in 143 seconds: 140.8 seconds in the model and 0.11 seconds in nutrition calculation. It included usable database values for 15 vegetarian and 14 vegan ingredients; some edible weights were unknown. These are ingredient counts, not percentages of calories or a guarantee of product identity. The fixture is intentionally difficult because strained bones, stock aromatics and packaged noodles have uncertain yields or brands. It is inspired by a tonkotsu recipe, not a transcription or a taste-tested adaptation.

Returning only ingredient replacements and changed instructions reduced the next run to 129 seconds (127.5 seconds in the model, 0.11 seconds in nutrition calculation). The response was 16,553 characters rather than 18,382. Cooking review found complete component instructions, with seitan browned separately and tare added gradually to taste. Coverage fell to 13 of 18 vegetarian and 12 of 18 vegan ingredients because the model treated possibly unused tare as an unknown quantity; the vegan avocado topping also lacked a reference. The follow-up added a selected avocado record and explicitly assumed the full supplied sauce amount, with a note about leftovers and alcohol loss.

That follow-up completed in 157 seconds from the client (154.9 seconds within the companion, including 0.1 seconds for nutrition). It produced 21 ingredients in each version, with complete instructions and explicit ready-to-eat seitan. The generated method strained out garlic, ginger, kombu and shiitake; their extraction yields correctly remain unknown. Tare amounts were retained with the stated full-consumption assumption. The vegetarian version used database values for 17 of 21 ingredients; the vegan version initially used 16 of 21, with frozen shelled edamame missing from the catalogue. Two selected edamame records now distinguish frozen unprepared and cooked weights. Recalculating the same generated recipe after adding them took 0.16 seconds without another AI request and gave both variants 17 of 21 usable database inputs. Missing nutrients and strained ingredients remain visibly partial.

These three faster runs took 129–157 seconds against the earlier 247-second database-assisted run, all using GPT-6.1-Sol. Recipe content still varies across generations, so this small experiment does not isolate a precise speedup or establish equivalence to web research. Database calculation is now a small part of elapsed time; the cooking response remains the main wait. None of these adaptations has been cooked or taste-tested.

## Other services

- [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) is connected using the newer [Search-a-licious API](https://openfoodfacts.github.io/search-a-licious/users/ref-openapi/) and v3 barcode reads. Read access needs no key. The client supplies an identifying User-Agent, limits uncached searches to 10/minute and reads to 15/minute, and caches for one hour. Its data have [ODbL attribution and reuse conditions](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/). The old search endpoint returned 503; the new search and product reads worked in roughly 0.1–0.2 seconds in initial checks.
- [Spoonacular](https://spoonacular.com/food-api/pricing) has a $0 plan with 50 points/day, a required backlink, and a one-hour maximum cache for user-requested data. It offers [recipe and substitute endpoints](https://spoonacular.com/food-api/docs), but needs its own key. We have not signed up or tested its responses.
- [Edamam](https://developer.edamam.com/edamam-nutrition-api) offers nutrition analysis, but its published plans and data caching terms are less suitable for Vegetate's saved recipe notebook. We have not connected it.

## Next experiment

Add reviewed product selection for the user's actual package and extend the food catalogue where missing ingredients materially affect totals. Do not infer exact brand identity from a model-generated barcode. Continue measuring complete recipe runs; database speed alone is not a recipe-generation benchmark.
