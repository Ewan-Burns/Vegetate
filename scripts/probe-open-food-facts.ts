import { createOpenFoodFactsProductReader, createOpenFoodFactsSearch } from "../companion/open-food-facts";

const args = process.argv.slice(2);
const start = performance.now();
try {
  const result = args[0] === "--barcode"
    ? await createOpenFoodFactsProductReader()(args[1] || "")
    : await createOpenFoodFactsSearch()({ query: args.join(" ") || "seitan" });
  console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - start), result }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Open Food Facts lookup failed.");
  process.exitCode = 1;
}
