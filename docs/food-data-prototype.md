# Food-data API prototype

25 October 2026. This branch adds a desktop-only `POST /api/food-search` route backed by USDA FoodData Central. It returns up to ten candidate foods with calories, protein, carbohydrate, fat, and fibre per 100 g where available. It **does not select a match automatically** or change generated recipes yet.

## Why USDA first

[USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) is free to access with an API key. Its data are public domain (CC0), and USDA asks to be credited. The documented default limit is 1,000 requests/hour per IP. The public `DEMO_KEY` supports initial testing but allows only 30 requests/hour and 50/day per IP. For continued testing, set `USDA_FDC_API_KEY` in the companion process environment or in a Git-ignored `.env.local` or `.env` file at the project root. The companion and `food:probe` load these files at startup, with existing process variables taking priority. The key stays on the Windows backend and is never returned to the browser. The prototype caches identical searches in memory for one hour.

The desktop review screen has an experimental **Try USDA food data instead** option. It searches up to 12 original ingredients, three at a time, and gives the AI the first three results for each search. These are candidates, not confirmed matches. The AI must still check preparation and edible yield, and replacement ingredients may remain estimates. If USDA is unavailable or rate limited, generation continues with clearly labelled assumptions. This mode turns off broad web research and is currently available only on the desktop. Restart the companion after adding or changing an env file.

The route accepts:

```json
{"query":"walnuts","dataTypes":["SR Legacy"],"pageSize":5}
```

It returns `matchPolicy: "review-required"` and candidate records with `fdcId`, description, data type, optional brand, source link, and nullable `per100g` fields. A missing nutrient stays `null`, rather than being treated as zero. Invalid input is rejected before contacting USDA. The route is limited to the local desktop, so a paired phone cannot spend the prototype's small demo quota.

To probe the API from this branch without stopping the currently running companion, use `npm.cmd run food:probe -- walnuts` from the project folder. Add `--branded` to inspect product-specific results. The command prints elapsed time and candidates, never the key. It will report a search-limit error while the shared `DEMO_KEY` is exhausted.

## First live checks

| Query | API time | Result |
| --- | ---: | --- |
| `walnuts`, SR Legacy/Foundation | 1.7 s | The first hit was **walnut oil**; English walnuts was the second hit (654 kcal, 15.2 g protein, 13.7 g carbs, 65.2 g fat, 6.7 g fibre per 100 g). |
| `lentils cooked`, SR Legacy/Foundation | 1.8 s | Cooked lentils were available, alongside different preparations such as sprouted lentils. |
| `seitan`, SR Legacy/Foundation | 1.3 s | No match. A separate Branded search reported 65 hits, but these represent different products and recipes. |

These are search timings, not full recipe generation timings. The shared `DEMO_KEY` then hit its rate limit; tests use representative responses to verify normalization and endpoint access. A personal free key is needed for sustained live comparisons. Candidate selection still needs review: using the first hit would have made the walnut nutrition wildly wrong.

An initial tonkotsu-style ramen run found a validation false positive for an ingredient explicitly labelled "without fish dashi"; the check and prompt were corrected. A second full adaptation completed in 268 seconds and produced vegetarian and vegan versions, but the exhausted demo quota meant no USDA candidates were used and all nutrition figures were unverified model estimates. This does not establish a speed or accuracy gain for the database mode.

## Other services

- [Open Food Facts](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/) is free for read access to packaged-product data, with 10 search requests/minute and 15 product reads/minute per IP. It requires an identifying User-Agent and has [ODbL attribution and reuse conditions](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/license-be-on-the-legal-side/). We have not connected it to this branch.
- [Spoonacular](https://spoonacular.com/food-api/pricing) has a $0 plan with 50 points/day, a required backlink, and a one-hour maximum cache for user-requested data. It offers [recipe and substitute endpoints](https://spoonacular.com/food-api/docs), but needs its own key. We have not signed up or tested its responses.
- [Edamam](https://developer.edamam.com/edamam-nutrition-api) offers nutrition analysis, but its published plans and data caching terms are less suitable for Vegetate's saved recipe notebook. We have not connected it.

## Next experiment

Keep a selected FDC candidate attached to an ingredient, record its preparation and assumed edible weight, and calculate the existing recipe's totals from those values. For branded seitan and other specialist substitutes, require a product-specific match or a clearly labelled estimate. Then benchmark the same recipes against the current ChatGPT-only and web-research paths. The source data lookup is fast; the model's cooking adaptation is still the main unmeasured part of this new route.
