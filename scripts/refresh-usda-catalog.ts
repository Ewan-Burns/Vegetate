import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadLocalEnv } from "./load-local-env";
import { createFoodKeyStore } from "../companion/food-key-store";
import { createWindowsEncryption } from "../companion/windows-encryption";
import { normalizeFdcSearch } from "../companion/food-data";
import type { FoodCandidate } from "../companion/food-data";

async function main() {
  loadLocalEnv();
  const localData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const stored = process.platform === "win32"
    ? await createFoodKeyStore(join(localData,"Vegetate","Secrets","usda-key.dpapi"),createWindowsEncryption()).read().catch(()=>undefined)
    : undefined;
  const key = stored || process.env.USDA_FDC_API_KEY;
  if (!key) throw new Error("Configure a USDA key before refreshing the catalogue.");
  const path = resolve(dirname(fileURLToPath(import.meta.url)),"../companion/data/usda-foods.json");
  const snapshot = JSON.parse(await readFile(path,"utf8")) as {foods:Record<string,FoodCandidate>};
  const entries = Object.entries(snapshot.foods);
  const foods: Record<string,FoodCandidate> = {};
  for (let i=0;i<entries.length;i+=4) {
    await Promise.all(entries.slice(i,i+4).map(async ([name,old]) => {
      const url = new URL(`https://api.nal.usda.gov/fdc/v1/food/${old.fdcId}`);
      url.searchParams.set("api_key",key);
      const response = await fetch(url,{signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error(`USDA catalogue refresh failed (HTTP ${response.status}). Existing catalogue retained.`);
      const data = await response.json();
      const record = normalizeFdcSearch(name,{foods:[{...data,foodNutrients:data.foodNutrients?.map((row:{nutrient:{name:string;unitName:string};amount:number})=>({nutrientName:row.nutrient?.name,unitName:row.nutrient?.unitName,value:row.amount}))}]}).candidates[0];
      if(!record || record.fdcId!==old.fdcId) throw new Error("USDA returned an unexpected catalogue record. Existing catalogue retained.");
      foods[name]=record;
    }));
  }
  if (!process.argv.includes("--check"))
    await writeFile(path,JSON.stringify({retrievedAt:new Date().toISOString(),source:"USDA FoodData Central",foods},null,2)+"\n");
  console.log(`${process.argv.includes("--check") ? "Verified" : "Refreshed"} ${entries.length} USDA records. No key was displayed.`);
}
main().catch(()=>{console.error("USDA catalogue refresh failed. Existing catalogue retained; no credentials displayed.");process.exitCode=1;});
