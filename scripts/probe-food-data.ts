import { createFoodSearch } from "../companion/food-data";

const args = process.argv.slice(2);
const branded = args.includes("--branded");
const query = args.filter((arg) => arg !== "--branded").join(" ").trim() || "walnuts";

try {
  const start = performance.now();
  const result = await createFoodSearch()({
    query,
    dataTypes: branded ? ["Branded"] : ["Foundation", "SR Legacy"],
    pageSize: 5,
  });
  console.log(
    JSON.stringify(
      {
        elapsedMs: Math.round(performance.now() - start),
        ...result,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Food search failed.");
  process.exitCode = 1;
}
