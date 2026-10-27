import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Recipe, Ingredient } from "../src/core/recipe";
import type { AIBundle, FastAIBundle, NutritionInput, PortionAssumption, Source } from "../src/core/ai-schema";
import { createOpenFoodFactsProductReader } from "./open-food-facts";

const nutrient = z.number().finite().min(0).nullable();
const recordSchema = z.object({
  fdcId: z.number().int().positive(), description: z.string(), dataType: z.string(),
  brandOwner: z.string().nullable(), sourceUrl: z.string().url(),
  per100g: z.object({ kcal: nutrient, protein: nutrient, carbs: nutrient, fat: nutrient, fiber: nutrient }),
});
const snapshot = z.object({retrievedAt:z.string(),foods:z.record(z.string(),recordSchema)}).parse(
  JSON.parse(readFileSync(new URL("./data/usda-foods.json", import.meta.url), "utf8")),
);
type NutritionRecord = Omit<z.infer<typeof recordSchema>, "fdcId">;

type Rule = { key: string; pattern: RegExp; reject?: RegExp; density?: number; each?: number; cup?: number; serving?: number; note?: string };
const rules: Rule[] = [
  {key:"seitan",pattern:/\bseitan\b/,reject:/\b(?:dry|flour|powder)\b/},
  {key:"gluten",pattern:/\bvital wheat gluten\b/},
  {key:"ramen",pattern:/\b(?:fresh|plant.based|egg.free|vegan).*ramen|\bramen noodles\b|\bfresh.*alkaline.*wheat noodles\b/,reject:/\b(?:instant|dry|dried|soup|cooked)\b/,serving:150,note:"Fresh plain ramen assumed; check the package and whether the weight is before cooking."},
  {key:"eggCooked",pattern:/\b(?:ramen eggs?|boiled eggs?|eggs?.*boiled)\b/,reject:/egg.free|plant.based|vegan/,each:50},
  {key:"egg",pattern:/\beggs?\b/,reject:/egg.free|plant.based|vegan|duck|quail|goose/,each:50},
  {key:"scallion",pattern:/\b(?:scallions?|spring onions?|green onions?)\b/,each:15},
  {key:"soyMilk",pattern:/\b(?:soy|soya)\s*milk\b/,reject:/\b(?:sweetened|vanilla|chocolate)\b/,density:1,note:"Unsweetened soymilk assumed when no product is specified."},
  {key:"edamameCooked",pattern:/\b(?:cooked|boiled|prepared)\b.*\bedamame\b|\bedamame\b.*\b(?:cooked|boiled|prepared)\b/,reject:/\b(?:pods?|unshelled|roasted|dry|dried|uncooked|unprepared)\b/,note:"Prepared shelled edamame reference; the weight must exclude pods."},
  {key:"edamameFrozen",pattern:/^(?=.*\bedamame\b)(?=.*\bfrozen\b)(?=.*\bshelled\b)/,reject:/\b(?:pods?|unshelled|roasted|dry|dried|cooked|boiled|prepared)\b/,note:"Frozen unprepared shelled edamame reference; weight is before cooking and excludes pods."},
  {key:"coconutMilk",pattern:/\bcoconut milk\b/,reject:/\b(?:light|drink|beverage)\b/,density:1,note:"Full-fat canned coconut milk assumed."},
  {key:"silkenTofu",pattern:/\b(?:silken|soft) tofu\b/,density:1,note:"Soft silken tofu reference used; brands vary."},
  {key:"tofu",pattern:/\btofu\b/,reject:/\b(?:silken|soft|fried|smoked|puff)\b/,density:1,note:"Firm calcium-set tofu reference used; brands vary."},
  {key:"cashewButter",pattern:/\bcashew butter\b/,density:1.05},
  {key:"tahini",pattern:/\btahini|\bsesame (?:butter|paste)\b/,reject:/\bsauce\b/,density:1.05},
  {key:"cashews",pattern:/\bcashews?\b/,reject:/butter|roasted|salted/,cup:137},
  {key:"avocado",pattern:/\bavocados?\b/,reject:/\b(?:oil|guacamole|dip|dressing|fried)\b/,each:150,cup:150,note:"Raw avocado flesh reference; whole-fruit portions assume 150 g edible flesh, excluding skin and stone."},
  {key:"sesameOil",pattern:/\bsesame oil\b/,density:0.92},
  {key:"oliveOil",pattern:/\bolive oil\b/,density:0.92},
  {key:"oil",pattern:/\b(?:neutral|vegetable|canola|rapeseed) oil\b/,density:0.92,note:"Canola oil used as the reference for neutral oil."},
  {key:"miso",pattern:/\bmiso\b/,reject:/\bsoup\b/,density:1.1},
  {key:"soySauce",pattern:/\bsoy sauce\b/,reject:/\b(?:sweet|dark)\b/,density:1.16,note:"Standard shoyu used; light-coloured sauces can differ."},
  {key:"mirin",pattern:/\bmirin\b/,density:1.1},
  {key:"sake",pattern:/\bsake\b/,density:1,note:"Alcohol evaporation is not deducted from the database energy value."},
  {key:"kombu",pattern:/\bkombu|\bdried kelp\b/,note:"Whole dried kombu reference; nutrients retained in strained dashi are uncertain."},
  {key:"shiitakeDried",pattern:/\bdried shiitake|\bshiitake.*dried\b/},
  {key:"shiitakeFresh",pattern:/\bshiitake\b/,reject:/dried|powder/},
  {key:"mushroom",pattern:/\bmushrooms?\b/,reject:/dried|shiitake|porcini|oyster|powder|cooked|boiled|roasted|fried/,cup:70,note:"Raw white mushroom reference used."},
  {key:"garlic",pattern:/\bgarlic\b/,reject:/powder|salt|paste|oil|cooked|boiled|roasted|fried/,each:3},
  {key:"ginger",pattern:/\bginger\b/,reject:/powder|dried|pickled|paste|cooked|boiled|roasted|fried/,each:25},
  {key:"onion",pattern:/\bonions?\b/,reject:/powder|dried|spring|green|fried|cooked|boiled|roasted/,each:110,cup:160},
  {key:"carrot",pattern:/\bcarrots?\b/,reject:/cooked|boiled|roasted|fried/,each:61,cup:128},
  {key:"tomato",pattern:/\b(?:passata|tomato puree|tomato purée|crushed tomatoes|canned tomatoes)\b/,reject:/paste|concentrated/,density:1.05,note:"Canned tomato puree used; concentrated tomato paste is different."},
  {key:"starch",pattern:/\b(?:cornstarch|cornflour|corn starch)\b/,density:0.53,cup:128},
  {key:"flour",pattern:/\b(?:plain|all.purpose|white|wheat) flour\b/,reject:/whole|self.rais/,cup:125},
  {key:"yeast",pattern:/\bnutritional yeast\b/,density:0.4},
  {key:"msg",pattern:/\bmsg\b|monosodium glutamate/,density:0.8},
  {key:"riceCooked",pattern:/\brice\b/,reject:/\b(?:dry|raw|uncooked|brown|wild)\b/,cup:158,note:"Cooked rice reference; used only when cooking state is explicit."},
  {key:"riceDry",pattern:/\brice\b/,reject:/\b(?:brown|wild|cooked)\b/,cup:185,note:"Dry white rice assumed."},
  {key:"pastaDry",pattern:/\b(?:pasta|spaghetti|tagliatelle|penne)\b/,reject:/cooked|fresh|egg|whole/,serving:80,note:"Dry plain wheat pasta assumed."},
  {key:"lentilsDry",pattern:/\b(?:dry|dried|raw|uncooked) lentils?\b/,cup:192},
  {key:"lentilsCooked",pattern:/\blentils?\b/,reject:/\b(?:dry|dried|raw|uncooked)\b/,cup:198,note:"Cooked and drained lentils assumed."},
  {key:"chickpea",pattern:/\b(?:chickpeas?|garbanzo)\b/,reject:/dry|raw|flour/,cup:164,note:"Canned drained chickpeas assumed."},
  {key:"whiteBeans",pattern:/\b(?:white|cannellini|navy) beans\b/,reject:/dry|raw/,cup:180,note:"Canned white beans assumed."},
  {key:"walnuts",pattern:/\bwalnuts?\b/,reject:/oil|glazed|candied/,cup:117},
  {key:"sugar",pattern:/\b(?:sugar|caster sugar|granulated sugar)\b/,reject:/brown|icing|powder|free/,density:0.83,cup:200},
  {key:"butter",pattern:/\bbutter\b/,reject:/vegan|plant|nut|peanut|almond|cashew|cocoa|beans/,density:0.95},
  {key:"cream",pattern:/\b(?:heavy|double|whipping) cream\b/,reject:/vegan|plant|coconut|cashew/,density:1},
  {key:"milk",pattern:/\b(?:whole )?milk\b/,reject:/vegan|plant|soy|soya|oat|coconut|almond|skim|semi/,density:1.03},
  {key:"chicken",pattern:/\bchicken breast\b/,reject:/vegan|plant|mock|meat.free|cooked|roasted|skin.on/,note:"Raw skinless chicken breast reference used."},
  {key:"beef",pattern:/\b(?:beef mince|ground beef|minced beef)\b/,reject:/vegan|plant|mock|meat.free|cooked/,note:"Raw 85% lean beef assumed; fat percentage varies."},
  {key:"pork",pattern:/\bpork belly\b/,reject:/vegan|plant|mock|chashu|cooked|braised/,note:"Raw pork belly reference used."},
  {key:"water",pattern:/^(?:water|filtered water|tap water)(?:$|,)/,density:1},
  {key:"salt",pattern:/^(?:salt|sea salt|table salt|kosher salt)(?:\b|,)/,reject:/\band\b/,density:1.2},
  {key:"pepper",pattern:/^(?:black pepper|ground black pepper)\b/,density:0.47},
];

export function matchNutritionProfile(name: string): Rule | undefined {
  const text = name.toLowerCase();
  if (/\b(?:soup|stew|curry|casserole|sausages?|burgers?|nuggets?|stock|broth)\b/.test(text)) return undefined;
  if (/\bgarlic\b/.test(text) && /\bbutter\b/.test(text)) return undefined;
  return rules.find(rule => {
    if (["riceDry","riceCooked"].includes(rule.key) && /\b(?:vinegar|wine|flour|milk|paper|noodles?|cakes?|crackers?|syrup|bran|oil|protein|pudding)\b/.test(text)) return false;
    if (["milk","soyMilk","coconutMilk","cream","egg","eggCooked"].includes(rule.key) && /\b(?:powder|powdered|dried|dehydrated|condensed|evaporated)\b/.test(text)) return false;
    if (["milk","soyMilk","coconutMilk","cream"].includes(rule.key) && /\b(?:(?:low|reduced)[ -]?fat|fat[ -]?free|non[ -]?fat|skim(?:med)?|semi[ -]?skimmed|light|lite)\b/.test(text)) return false;
    if (rule.key === "milk") {
      const statedFat = text.match(/\b(\d+(?:\.\d+)?)\s*%/);
      if (statedFat && Number(statedFat[1]) <= 10 && Number(statedFat[1]) !== 3.25) return false;
    }
    if (["garlic","ginger","onion","scallion","carrot","mushroom","shiitakeFresh","chicken","beef","pork","egg"].includes(rule.key) && /\b(?:cooked|boiled|roasted|fried|grilled|baked|pickled)\b/.test(text)) return false;
    if (["garlic","egg","butter"].includes(rule.key) && /\b(?:bread|noodles?|pasta|sauce|dressing)\b/.test(text)) return false;
    if (rule.key === "egg" && /\b(?:whites?|yolks?|substitute)\b/.test(text)) return false;
    if (rule.key === "riceCooked" && !/\bcooked\b/.test(text)) return false;
    return rule.pattern.test(text) && !rule.reject?.test(text);
  });
}

export function inferEdibleGrams(item: Ingredient, rule?: Rule): {grams:number|null;note:string} {
  if (item.quantity === null) {
    const grams = rule?.serving || rule?.each || (rule?.density ? 15 * rule.density : null);
    return {grams,note:grams ? `Portion assumption: missing amount estimated as ${grams} g.` : "No usable amount was supplied."};
  }
  const q = item.quantity, unit = item.unit.toLowerCase().trim().replace(/\.$/, "");
  const mass: Record<string,number> = {g:1,gram:1,grams:1,kg:1000,kilogram:1000,kilograms:1000,mg:0.001,oz:28.3495,ounce:28.3495,ounces:28.3495,lb:453.592,lbs:453.592};
  if (mass[unit]) return {grams:q*mass[unit],note:""};
  const density = rule?.cup !== undefined ? rule.cup / 240 : rule?.density;
  if (/^(?:ml|millilitres?|milliliters?|l|litres?|liters?)$/.test(unit)) {
    if (density === undefined) return {grams:null,note:"This volume measure needs an ingredient-specific weight."};
    return {grams:q*(/^(l|litre|liter)/.test(unit)?1000:1)*density,note:`Portion assumption: volume converted at ${density} g/ml.`};
  }
  const volume = /^(?:tbsp|tablespoons?)$/.test(unit)?15:/^(?:tsp|teaspoons?)$/.test(unit)?5:/^cups?$/.test(unit)?240:0;
  if (volume) {
    const grams = density === undefined ? null : q*volume*density;
    return {grams,note:grams ? "Portion assumption: household measure converted using a typical weight." : "This household measure needs an ingredient-specific weight."};
  }
  if (/^(?:servings?|portions?)$/.test(unit) && rule?.serving)
    return {grams:q*rule.serving,note:`Portion assumption: ${rule.serving} g per serving before cooking.`};
  if (rule?.key === "garlic" && /^heads?$/.test(unit)) return {grams:q*45,note:"Portion assumption: 45 g edible garlic per head."};
  if (rule?.each && /^(?:|each|whole|medium|large|small|cloves?|knobs?|pieces?|stalks?)$/.test(unit))
    return {grams:q*rule.each,note:`Portion assumption: ${rule.each} g per item.`};
  return {grams:null,note:`No reliable gram conversion for unit '${item.unit}'.`};
}

export function createDatabaseNutrition(options: {readProduct?: ReturnType<typeof createOpenFoodFactsProductReader>} = {}) {
  const readProduct = options.readProduct || createOpenFoodFactsProductReader();
  async function inputs(recipe: Recipe, portions: PortionAssumption[]) {
    return Promise.all(recipe.ingredients.map(async (item): Promise<NutritionInput> => {
      const rule = matchNutritionProfile(item.name);
      let food: NutritionRecord | undefined = rule ? snapshot.foods[rule.key] : undefined;
      let sourceLabel = "USDA FoodData Central";
      let proxy = food?.dataType === "Branded" ? `Representative product: ${food.brandOwner || food.description}; check your own label.` : "";
      if (rule?.key === "seitan") {
        try {
          const product = await readProduct("5600341931244");
          food = {description:product.description,dataType:"Branded",brandOwner:product.brand,per100g:product.per100g,sourceUrl:product.sourceUrl};
          sourceLabel = "Open Food Facts contributors (ODbL)";
          proxy = `Representative product: ${product.brand || ""} ${product.description}; used as an estimate. Check your own brand and package label.`;
        } catch { /* A selected USDA record remains available if product lookup is down. */ }
      }
      const portion = portions.filter(row=>row.ingredientId===item.id);
      const weight = portion.length===1
        ? {grams:portion[0].grams,note:`Portion assumption: ${portion[0].note || "edible weight estimated by the recipe model"}`}
        : inferEdibleGrams(item,rule);
      const n = food?.per100g;
      return {
        ingredientId:item.id, grams:weight.grams,
        kcalPer100g:n?.kcal??null,proteinPer100g:n?.protein??null,carbsPer100g:n?.carbs??null,fatPer100g:n?.fat??null,fiberPer100g:n?.fiber??null,
        sourceUrl:food?.sourceUrl??null,
        note:[food?`Database: ${sourceLabel} — ${food.description}.`:"No checked database match for this ingredient.",proxy,rule?.note,weight.note].filter(Boolean).join(" ").slice(0,700),
      };
    }));
  }
  return async (fast: FastAIBundle, original: Recipe): Promise<{data:AIBundle;sources:Source[];databaseSources:string[]}> => {
    const [originalInputs,vegetarianInputs,veganInputs] = await Promise.all([
      inputs(original,fast.originalPortionAssumptions),
      inputs({...fast.vegetarian.recipe,id:`${original.id}-vegetarian`},fast.vegetarian.portionAssumptions),
      inputs({...fast.vegan.recipe,id:`${original.id}-vegan`},fast.vegan.portionAssumptions),
    ]);
    const sources = [...new Map([...originalInputs,...vegetarianInputs,...veganInputs].filter(row=>row.sourceUrl).map(row=>[row.sourceUrl!,{url:row.sourceUrl!,title:row.note.split(". ")[0]}])).values()];
    const {originalPortionAssumptions: _original,vegetarian,vegan,...base} = fast;
    const {portionAssumptions:_veg,...veg}=vegetarian;
    const {portionAssumptions:_vegan,...veganRecipe}=vegan;
    return {
      data:{...base,originalNutritionInputs:originalInputs,vegetarian:{...veg,nutritionInputs:vegetarianInputs},vegan:{...veganRecipe,nutritionInputs:veganInputs}},
      sources,databaseSources:sources.map(source=>source.url),
    };
  };
}
