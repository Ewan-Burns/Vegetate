# Nutrition reference snapshot

`usda-foods.json` contains explicitly selected FoodData Central records retrieved from the official USDA API. The source URL, FDC ID, data type, retrieval date, and literal reported nutrients travel with each record. Missing nutrients remain null. USDA data are public domain (CC0); credit: USDA FoodData Central, https://fdc.nal.usda.gov/.

Refresh the selected IDs with `npm.cmd run food:refresh` after configuring the USDA key. This refreshes existing selections; it does not silently replace them with search results. Selecting additional foods requires reviewing their identity, preparation state and label. Branded entries are representative products unless the user specifies the matching product.

Open Food Facts product data are fetched separately at runtime, attributed to Open Food Facts contributors (ODbL), and are not included in this USDA snapshot. See https://world.openfoodfacts.org/terms-of-use.
