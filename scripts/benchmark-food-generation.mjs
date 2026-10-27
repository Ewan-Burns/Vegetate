// Manual experiment only: invoking this script consumes connected ChatGPT plan usage.
// Synthetic benchmark inspired by the components described at this source; it is
// not a transcription of its recipe, and its assumed quantities are test data.
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceReference = "https://www.justonecookbook.com/easy-tonkotsu-ramen-recipe/";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = "http://127.0.0.1:8787";
const recipe = {
  id: "tonkotsu-benchmark",
  title: "Tonkotsu ramen benchmark",
  servings: 4,
  ingredients: [
    { id: "bones", name: "pork leg bones", quantity: 1600, unit: "g" },
    { id: "hock", name: "pork hock with skin", quantity: 590, unit: "g" },
    { id: "garlic", name: "garlic", quantity: 85, unit: "g" },
    { id: "ginger", name: "fresh ginger", quantity: 25, unit: "g" },
    { id: "kombu", name: "kombu dried kelp", quantity: 15, unit: "g" },
    { id: "shiitake", name: "dried shiitake mushrooms", quantity: 16, unit: "g" },
    { id: "anchovy", name: "dried anchovies", quantity: 8, unit: "g" },
    { id: "sake", name: "sake", quantity: 60, unit: "ml" },
    { id: "mirin", name: "mirin", quantity: 30, unit: "ml" },
    { id: "soy", name: "light soy sauce", quantity: 60, unit: "ml" },
    { id: "noodles", name: "fresh ramen noodles", quantity: 600, unit: "g" },
    { id: "eggs", name: "ramen eggs", quantity: 4, unit: "each" },
    { id: "pork", name: "chashu pork belly", quantity: 200, unit: "g" },
    { id: "scallions", name: "green onions", quantity: 100, unit: "g" },
    { id: "salt", name: "salt", quantity: 25, unit: "g" },
    { id: "water", name: "water", quantity: 2500, unit: "ml" },
  ],
  steps: [
    "Clean the bones and hock, pressure cook with garlic and ginger, then boil hard until the broth emulsifies and strain it.",
    "Steep the kombu, dried shiitake and anchovies for dashi; combine with the broth.",
    "Make a tare from sake, mirin, light soy sauce and salt. Cook the noodles separately.",
    "Add tare and broth to each bowl, then noodles, pork belly, halved eggs and green onions.",
  ],
};

function options(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  let mode = "database";
  let tag;
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--mode") mode = args[++i];
    else if (argument.startsWith("--mode=")) mode = argument.slice(7);
    else if (!argument.startsWith("-") && tag === undefined) tag = argument;
    else throw new Error("Use one output tag and optional --mode database, web, or estimate. See --help.");
  }
  if (!["database", "web", "estimate"].includes(mode))
    throw new Error("Mode must be database, web, or estimate.");
  if (tag !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tag))
    throw new Error("Output tag must use 1–64 letters, numbers, underscores, or hyphens.");
  return { mode, tag: tag || new Date().toISOString().replace(/[:.]/g, "-") };
}

const seconds = (milliseconds) => Number.isFinite(milliseconds)
  ? Math.round(milliseconds / 100) / 10
  : null;

function coverage(ingredients, rows, verifiedSources) {
  let databaseIngredients = 0;
  let missingMacroIngredients = 0;
  let missingFibreIngredients = 0;
  let representativeProducts = 0;
  for (const ingredient of ingredients) {
    const matches = rows.filter((row) => row.ingredientId === ingredient.id);
    const row = matches.length === 1 ? matches[0] : undefined;
    const hasMacros = row && ["grams", "kcalPer100g", "proteinPer100g", "carbsPer100g", "fatPer100g"]
      .every((field) => typeof row[field] === "number" && Number.isFinite(row[field]));
    if (!hasMacros) missingMacroIngredients++;
    if (!row || row.fiberPer100g === null || row.fiberPer100g === undefined)
      missingFibreIngredients++;
    if (hasMacros && verifiedSources.has(row.sourceUrl)) databaseIngredients++;
    if (row?.note?.includes("Representative product:")) representativeProducts++;
  }
  return {
    databaseIngredients,
    totalIngredients: ingredients.length,
    databaseCoveragePercent: Math.round(100 * databaseIngredients / ingredients.length),
    missingMacroIngredients,
    missingFibreIngredients,
    representativeProducts,
  };
}

async function post(action, body, signal) {
  let response;
  try {
    response = await fetch(`${endpoint}/api/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: endpoint },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("The desktop companion could not be reached. Start it locally, then rerun this manual benchmark.");
  }
  if (!response.ok) throw new Error(`The companion returned HTTP ${response.status} for ${action}. Check its app page before retrying.`);
  try { return await response.json(); }
  catch { throw new Error("The companion returned an unreadable response."); }
}

async function main() {
  const settings = options(process.argv.slice(2));
  if (settings.help) {
    console.log("Manual food-generation benchmark — consumes ChatGPT plan usage when run.");
    console.log("Usage: npm.cmd run food:benchmark -- [output-tag] [--mode database|web|estimate]");
    console.log("Default: database mode. Requires the local companion and its existing ChatGPT connection.");
    console.log("Writes recipe output to .cache/benchmark-tonkotsu-<tag>.json; it never reads or prints API keys.");
    return;
  }
  const directory = resolve(root, ".cache");
  const filename = `benchmark-tonkotsu-${settings.tag}.json`;
  const destination = resolve(directory, filename);
  await mkdir(directory, { recursive: true });
  try {
    await access(destination, constants.F_OK);
    throw new Error("That benchmark output tag already exists. Choose a new tag to preserve previous results.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  console.log(`Manual ${settings.mode} benchmark: sending one synthetic recipe adaptation; this consumes connected ChatGPT plan usage.`);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  let job;
  const started = performance.now();
  try {
    ({ job } = await post("adapt", {
      recipe,
      research: settings.mode === "web",
      foodData: settings.mode === "database",
    }, controller.signal));
    if (typeof job !== "string") throw new Error("The companion did not return a job reference.");
    let result;
    const deadline = performance.now() + 10 * 60_000;
    while (performance.now() < deadline) {
      if (controller.signal.aborted) throw new Error("Benchmark cancelled.");
      result = await post("result", { job, recipe }, controller.signal);
      if (result.status === "completed") break;
      if (result.status !== "running") throw new Error("The recipe generation stopped before completion.");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (result?.status !== "completed") throw new Error("The benchmark exceeded its ten-minute deadline.");
    const saved = {
      benchmark: { fixture: "synthetic-tonkotsu-style-v1", sourceReference, mode: settings.mode, generatedAt: new Date().toISOString() },
      recipe,
      data: result.data,
      sources: result.sources,
      databaseSources: result.databaseSources,
      timings: result.timings,
      foodData: result.foodData,
    };
    await writeFile(destination, JSON.stringify(saved, null, 2), { flag: "wx" });
    const verifiedSources = new Set(result.databaseSources || []);
    console.log(JSON.stringify({
      mode: settings.mode,
      output: `.cache/${filename}`,
      clientSeconds: seconds(performance.now() - started),
      modelSeconds: seconds(result.timings?.modelMs),
      nutritionSeconds: seconds(result.timings?.nutritionMs),
      totalSeconds: seconds(result.timings?.totalMs),
      responseCharacters: result.timings?.responseChars ?? null,
      sourceIngredientCoverage: {
        original: coverage(recipe.ingredients, result.data.originalNutritionInputs, verifiedSources),
        vegetarian: coverage(result.data.vegetarian.recipe.ingredients, result.data.vegetarian.nutritionInputs, verifiedSources),
        vegan: coverage(result.data.vegan.recipe.ingredients, result.data.vegan.nutritionInputs, verifiedSources),
      },
      note: "Database values can still use representative products or assumed portions. Review the saved recipe output.",
    }, null, 2));
  } catch (error) {
    if (job) await post("cancel", { job }).catch(() => {});
    throw error;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}

main().catch((error) => {
  console.error(`Food benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
