import { useEffect, useRef, useState } from "react";
import type { Adaptation, DietMode, Ingredient, Recipe } from "./core/recipe";
import { ingredientLabel, scaleRecipe, validateRecipe } from "./core/recipe";
import { importRecipe } from "./core/import";
import { SAMPLE_TEXT } from "./core/sample";
import {
  adaptWithAI,
  extractWithAI,
  getAIStatus,
  unlockAI,
  signInWithChatGPT,
  signOutChatGPT,
  selectModel,
} from "./core/ai-client";
import type { AIStatus } from "./core/ai-client";
import { extractionToRecipe } from "./core/ai-schema";
import type { AdaptationBundle, NutritionEstimate } from "./core/ai-schema";
import { readNotebook, writeNotebook, mergeNotebook } from "./core/storage";
import type { NotebookEntry } from "./core/storage";
import { Dialog } from "./components/Dialog";
import { Icon } from "./components/Icons";

type View = "import" | "review" | "result";
type ResultMode = DietMode | "original";

function readInitial() {
  try {
    return readNotebook(localStorage);
  } catch {
    return {
      entries: [],
      error: "Storage is unavailable. Recipes cannot be saved in this browser.",
    };
  }
}
function readAccessCode() {
  try {
    return sessionStorage.getItem("vegetate.access-code") || "";
  } catch {
    return "";
  }
}

function Servings({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="servings">
      <span>Servings</span>
      <button
        className="icon-button"
        aria-label="Fewer servings"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Icon name="minus" size={16} />
      </button>
      <output aria-label="Selected servings">{value}</output>
      <button
        className="icon-button"
        aria-label="More servings"
        disabled={value >= 24}
        onClick={() => onChange(value + 1)}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function Cook({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  return (
    <Dialog
      title="Cooking instructions"
      onClose={onClose}
      className="cook-dialog"
    >
      <p>
        {recipe.title} · {recipe.servings} servings
      </p>
      <progress
        value={step + 1}
        max={recipe.steps.length}
        aria-label="Cooking progress"
      />
      <h3 ref={heading} tabIndex={-1}>
        Step {step + 1} of {recipe.steps.length}
      </h3>
      <p className="cook-step">{recipe.steps[step]}</p>
      <details>
        <summary>Ingredients</summary>
        <ul className="checklist">
          {recipe.ingredients.map((item) => (
            <li key={item.id}>
              <label>
                <input type="checkbox" />
                <span>{ingredientLabel(item)}</span>
              </label>
            </li>
          ))}
        </ul>
      </details>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
        >
          Previous
        </button>
        <button
          className="button primary"
          onClick={() =>
            step === recipe.steps.length - 1 ? onClose() : setStep(step + 1)
          }
        >
          {step === recipe.steps.length - 1 ? "Finish" : "Next step"}
        </button>
      </div>
    </Dialog>
  );
}

function Nutrition({ bundle }: { bundle: AdaptationBundle }) {
  const estimates: [string, NutritionEstimate | undefined][] = [
    ["Original", bundle.originalNutrition],
    ["Vegetarian", bundle.vegetarian.nutrition],
    ["Vegan", bundle.vegan.nutrition],
  ];
  return (
    <section className="panel">
      <h3>Estimated macros per serving</h3>
      <p className="muted">
        Calculated from sourced ingredient estimates. Quantities, conversions
        and product differences can affect these figures.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Recipe</th>
              <th>kcal</th>
              <th>Protein</th>
              <th>Carbs</th>
              <th>Fat</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map(([name, estimate]) => (
              <tr key={name}>
                <th>{name}</th>
                {(["kcal", "protein", "carbs", "fat"] as const).map((key) => (
                  <td key={key}>
                    {estimate?.perServing
                      ? `${estimate.perServing[key]}${key === "kcal" ? "" : " g"}`
                      : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {estimates.some(([, estimate]) => !estimate?.perServing) && (
        <p className="muted">
          A dash means the available ingredient data is insufficient for a
          complete estimate.
        </p>
      )}
      <details>
        <summary>Nutrition assumptions and missing data</summary>
        {estimates.map(([name, estimate]) => (
          <div key={name}>
            <h4>{name}</h4>
            {estimate?.missingIngredients.length ? (
              <p>
                Missing reliable data: {estimate.missingIngredients.join(", ")}.
              </p>
            ) : null}
            {estimate?.notes.length ? (
              <ul>
                {estimate.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </details>
    </section>
  );
}

export function App() {
  const [initial] = useState(readInitial);
  const [entries, setEntries] = useState(initial.entries);
  const [view, setView] = useState<View>("import");
  const [input, setInput] = useState("");
  const [original, setOriginal] = useState<Recipe | null>(null);
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [bundle, setBundle] = useState<AdaptationBundle | null>(null);
  const [legacy, setLegacy] = useState<Adaptation | null>(null);
  const [mode, setMode] = useState<ResultMode>("vegan");
  const [servings, setServings] = useState(4);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [code, setCode] = useState(readAccessCode);
  const [codeInput, setCodeInput] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [busy, setBusy] = useState<"extract" | "adapt" | null>(null);
  const [research, setResearch] = useState(true);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [toast, setToast] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const controller = useRef<AbortController | null>(null);
  const first = useRef(true);
  const importFile = useRef<HTMLInputElement>(null);

  async function refreshStatus(currentCode = code) {
    try {
      setStatus(await getAIStatus(currentCode));
      setStatusError("");
    } catch (cause) {
      setStatus(null);
      setStatusError(
        cause instanceof Error ? cause.message : "AI service unavailable.",
      );
    }
  }
  useEffect(() => {
    void refreshStatus();
    const online = () => {
      setOffline(false);
      void refreshStatus();
    };
    const off = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document
      .querySelector<HTMLElement>("[data-page-heading]")
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);
  useEffect(() => {
    if (!connectionOpen || status?.session?.status !== "connecting") return;
    const timer = setInterval(() => void refreshStatus(), 2000);
    return () => clearInterval(timer);
  }, [connectionOpen, status?.session?.status]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  function requireAI(): boolean {
    if (offline) {
      setError(
        "AI generation needs an internet connection. Saved recipes still work offline.",
      );
      return false;
    }
    if (!status?.configured) {
      setError(
        "Automatic adaptation is not connected yet. Open AI connection for its status.",
      );
      return false;
    }
    if (!code && !status.local) {
      setConnectionOpen(true);
      return false;
    }
    return true;
  }
  function showOriginal(recipe: Recipe, messages: string[], sourceUrl = "") {
    setOriginal(recipe);
    setMethod(recipe.steps.join("\n\n"));
    setServings(recipe.servings || 4);
    setSource(sourceUrl);
    setNotices(messages);
    setBundle(null);
    setLegacy(null);
    setSavedId(null);
    setView("review");
  }
  async function importInput() {
    setError("");
    if (!input.trim()) {
      setError("Paste a recipe or a recipe link first.");
      return;
    }
    if (!status?.configured || offline) {
      if (/^https?:\/\//i.test(input.trim())) {
        setError(
          "Reading a recipe link requires a live AI connection. You can paste the recipe text to review and save it now.",
        );
        return;
      }
      try {
        const parsed = importRecipe(input);
        showOriginal(parsed.recipe, [
          "Imported without AI. Check the extracted fields.",
          ...parsed.notices,
        ]);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not import this recipe.",
        );
      }
      return;
    }
    if (!requireAI()) return;
    const current = new AbortController();
    controller.current = current;
    setBusy("extract");
    try {
      const extracted = await extractWithAI(input, code, current.signal);
      showOriginal(
        extractionToRecipe(extracted, crypto.randomUUID()),
        [...extracted.missingInformation, ...extracted.warnings],
        extracted.sourceUrl || "",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Recipe extraction failed.",
      );
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(null);
      }
    }
  }
  function updateOriginal(next: Recipe) {
    setOriginal(next);
    setBundle(null);
    setLegacy(null);
    setError("");
  }
  function updateIngredient(id: string, patch: Partial<Ingredient>) {
    if (original)
      updateOriginal({
        ...original,
        ingredients: original.ingredients.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      });
  }
  async function generate() {
    if (!original) return;
    setError("");
    const issues = validateRecipe(original);
    if (issues.length) {
      setError(issues.join(" "));
      return;
    }
    if (!requireAI()) return;
    const current = new AbortController();
    controller.current = current;
    setBusy("adapt");
    try {
      const result = await adaptWithAI(
        original,
        code,
        current.signal,
        research,
      );
      setBundle(result);
      setLegacy(null);
      setMode("vegan");
      setView("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Adaptation failed.");
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(null);
      }
    }
  }
  function save() {
    if (!original) return;
    if (initial.error) {
      setError(initial.error);
      return;
    }
    const issues = validateRecipe(original);
    if (issues.length) {
      setError(issues.join(" "));
      return;
    }
    const entry: NotebookEntry = {
      id: savedId || crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      servings,
      original: structuredClone(original),
      ...(bundle ? { bundle: structuredClone(bundle) } : {}),
      ...(legacy ? { adaptation: structuredClone(legacy) } : {}),
      ...(source ? { sourceUrl: source } : {}),
    };
    const next = [entry, ...entries.filter((item) => item.id !== entry.id)];
    try {
      writeNotebook(localStorage, next);
      setEntries(next);
      setSavedId(entry.id);
      setToast("Recipe saved.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this recipe.",
      );
    }
  }
  function openEntry(entry: NotebookEntry) {
    setOriginal(structuredClone(entry.original));
    setMethod(entry.original.steps.join("\n\n"));
    setBundle(entry.bundle ? structuredClone(entry.bundle) : null);
    setLegacy(entry.adaptation ? structuredClone(entry.adaptation) : null);
    setMode(entry.bundle ? "vegan" : entry.adaptation?.mode || "original");
    setServings(entry.servings);
    setSavedId(entry.id);
    setSource(entry.sourceUrl || "");
    setNotices([]);
    setError("");
    setView(entry.bundle || entry.adaptation ? "result" : "review");
    setNotebookOpen(false);
  }
  function removeEntry(id: string) {
    if (initial.error) {
      setError(initial.error);
      return;
    }
    const next = entries.filter((item) => item.id !== id);
    try {
      writeNotebook(localStorage, next);
      setEntries(next);
      if (savedId === id) setSavedId(null);
      setToast("Saved recipe removed.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update the notebook.",
      );
    }
  }
  function exportEntries() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, recipes: entries }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "vegetate-recipes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importEntries(file?: File) {
    if (!file) return;
    try {
      if (initial.error) throw new Error(initial.error);
      if (file.size > 2_000_000)
        throw new Error("This file is too large for a recipe notebook.");
      const merged = mergeNotebook(await file.text(), entries);
      writeNotebook(localStorage, merged.entries);
      setEntries(merged.entries);
      setToast(`Imported ${merged.added} recipes.`);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import that notebook.",
      );
    } finally {
      if (importFile.current) importFile.current.value = "";
    }
  }

  async function connect() {
    setConnectionError("");
    try {
      const token = await unlockAI(codeInput);
      setCode(token);
      try {
        sessionStorage.setItem("vegetate.access-code", token);
      } catch {
        /* The current page can still use the connection. */
      }
      setConnectionOpen(false);
      await refreshStatus(token);
      setToast("AI connection unlocked.");
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : "Could not unlock AI.",
      );
    }
  }
  async function signIn() {
    setConnectionError("");
    try {
      await signInWithChatGPT(
        status?.session?.status === "connected" && !status.session.sharing,
      );
      await refreshStatus();
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : "Sign-in failed.",
      );
    }
  }
  async function changeModel(model: string) {
    setConnectionError("");
    try {
      await selectModel(model, code);
      await refreshStatus();
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : "Could not select this model.",
      );
    }
  }
  async function signOut() {
    setConnectionError("");
    try {
      await signOutChatGPT();
      setCode("");
      sessionStorage.removeItem("vegetate.access-code");
      await refreshStatus("");
    } catch (cause) {
      setConnectionError(
        cause instanceof Error ? cause.message : "Sign-out failed.",
      );
    }
  }

  const adaptation =
    mode === "original"
      ? null
      : bundle?.[mode] || (legacy?.mode === mode ? legacy : null);
  const selected = adaptation?.recipe || original;
  const displayed =
    selected && selected.servings > 0 ? scaleRecipe(selected, servings) : null;

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to recipe
      </a>
      <header className="header">
        <h1>Vegetate</h1>
        <nav aria-label="Main navigation">
          <button
            disabled={!!busy}
            onClick={() => {
              setView("import");
              setError("");
            }}
          >
            New recipe
          </button>
          <button
            onClick={() => {
              setNotebookOpen(true);
              setError("");
            }}
          >
            Saved recipes{entries.length ? ` (${entries.length})` : ""}
          </button>
          <button
            onClick={() => {
              setConnectionOpen(true);
              setConnectionError("");
              setCodeInput(code);
            }}
          >
            AI connection
          </button>
        </nav>
      </header>
      <main id="main">
        {offline && (
          <p className="notice" role="status">
            Offline. You can read saved recipes and review pasted text. AI
            generation needs a connection.
          </p>
        )}
        {!offline && !status?.configured && (
          <p className="notice">
            Automatic AI is not connected yet. Text review and saved recipes are
            available.{" "}
            <button
              className="text-button"
              onClick={() => setConnectionOpen(true)}
            >
              Connection status
            </button>
          </p>
        )}
        {busy && (
          <div className="working" role="status">
            <strong>
              {busy === "extract"
                ? "Reading the original recipe…"
                : "Researching and preparing both adaptations…"}
            </strong>
            <p>
              {busy === "extract"
                ? "Extracting ingredients, quantities, servings and instructions."
                : "Comparing ingredient functions, replacement techniques, cooking changes and macro tradeoffs. This can take a few minutes."}
            </p>
            <button
              className="button secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancel generation
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {view === "import" && (
          <section className="panel import-panel">
            <h2 data-page-heading tabIndex={-1}>
              Import a recipe
            </h2>
            <label htmlFor="recipe-input">Recipe text or link</label>
            <textarea
              id="recipe-input"
              value={input}
              maxLength={30000}
              disabled={!!busy}
              placeholder={"Paste a recipe or https://…"}
              onChange={(event) => {
                setInput(event.target.value);
                setError("");
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped =
                  event.dataTransfer
                    .getData("text/uri-list")
                    .split("\n")
                    .find((line) => line && !line.startsWith("#")) ||
                  event.dataTransfer.getData("text/plain");
                if (dropped) setInput(dropped);
                else
                  setError(
                    "Drop a recipe link or plain text. File and image import are not supported yet.",
                  );
              }}
            />
            <p className="muted">
              Paste or drop a link, or paste the full recipe. Review the
              extracted information before adapting it.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                disabled={!!busy || !input.trim()}
                onClick={importInput}
              >
                Import recipe
              </button>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setInput(SAMPLE_TEXT)}
              >
                Load example text
              </button>
            </div>
          </section>
        )}
        {view === "review" && original && (
          <>
            <div className="page-heading">
              <h2 data-page-heading tabIndex={-1}>
                Review original recipe
              </h2>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => setView("import")}
              >
                Back to import
              </button>
            </div>
            {notices.length > 0 && (
              <div className="notice">
                <strong>Check these details</strong>
                <ul>
                  {notices.map((notice, index) => (
                    <li key={index}>{notice}</li>
                  ))}
                </ul>
              </div>
            )}
            {source && (
              <p className="source-line">
                Source:{" "}
                <a href={source} target="_blank" rel="noreferrer">
                  {source}
                </a>
              </p>
            )}
            <fieldset className="panel editor" disabled={!!busy}>
              <div className="editor-top">
                <div>
                  <label htmlFor="recipe-title">Recipe name</label>
                  <input
                    id="recipe-title"
                    value={original.title}
                    maxLength={200}
                    onChange={(event) =>
                      updateOriginal({ ...original, title: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="original-servings">Original servings</label>
                  <input
                    id="original-servings"
                    type="number"
                    min="1"
                    max="24"
                    inputMode="numeric"
                    value={original.servings || ""}
                    onChange={(event) =>
                      updateOriginal({
                        ...original,
                        servings: Number(event.target.value),
                      })
                    }
                  />
                </div>
              </div>
              <h3>Ingredients</h3>
              <div className="ingredient-column-labels" aria-hidden="true">
                <span>Amount</span>
                <span>Unit</span>
                <span>Ingredient and preparation</span>
              </div>
              {original.ingredients.map((item, index) => (
                <div className="ingredient-edit-row" key={item.id}>
                  <input
                    aria-label={`Amount for ingredient ${index + 1}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0.001"
                    placeholder="Unknown"
                    value={item.quantity ?? ""}
                    onChange={(event) =>
                      updateIngredient(item.id, {
                        quantity:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                  <input
                    aria-label={`Unit for ingredient ${index + 1}`}
                    value={item.unit}
                    maxLength={40}
                    onChange={(event) =>
                      updateIngredient(item.id, { unit: event.target.value })
                    }
                  />
                  <input
                    aria-label={`Name of ingredient ${index + 1}`}
                    value={item.name}
                    maxLength={240}
                    onChange={(event) =>
                      updateIngredient(item.id, { name: event.target.value })
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label={`Remove ingredient ${index + 1}`}
                    onClick={() =>
                      updateOriginal({
                        ...original,
                        ingredients: original.ingredients.filter(
                          (ingredient) => ingredient.id !== item.id,
                        ),
                      })
                    }
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  updateOriginal({
                    ...original,
                    ingredients: [
                      ...original.ingredients,
                      {
                        id: crypto.randomUUID(),
                        name: "",
                        quantity: null,
                        unit: "",
                      },
                    ],
                  })
                }
              >
                Add ingredient
              </button>
              <label htmlFor="original-method" className="method-label">
                Original instructions{" "}
                <span className="muted">One step per paragraph</span>
              </label>
              <textarea
                id="original-method"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value);
                  updateOriginal({
                    ...original,
                    steps: event.target.value
                      .split(/\n\s*\n/)
                      .map((step) => step.replace(/^\d+[.)]\s*/, "").trim()),
                  });
                }}
              />
            </fieldset>
            <section className="panel">
              <h3>Adapt this recipe</h3>
              <p>
                Taste and texture first, then a similar balance of calories,
                protein, carbs and fat. Both vegetarian and vegan versions will
                be generated.
              </p>
              <p className="muted">
                The AI may research techniques and prepare separate components
                where a simple ingredient swap will not work.
              </p>
              <label className="research-option">
                <input
                  type="checkbox"
                  checked={research}
                  disabled={!!busy}
                  onChange={(event) => setResearch(event.target.checked)}
                />{" "}
                Use online research when adapting
              </label>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={generate}
                >
                  Generate vegetarian + vegan recipes
                </button>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={save}
                >
                  Save original recipe
                </button>
              </div>
            </section>
          </>
        )}
        {view === "result" && original && displayed && (
          <>
            <div className="page-heading">
              <h2 data-page-heading tabIndex={-1}>
                {original.title}
              </h2>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => setView("review")}
              >
                Edit original
              </button>
            </div>
            <div className="result-controls">
              <div className="mode-tabs" aria-label="Recipe version">
                {(["original", "vegetarian", "vegan"] as ResultMode[]).map(
                  (option) => (
                    <button
                      key={option}
                      aria-pressed={mode === option}
                      disabled={
                        option !== "original" &&
                        !bundle &&
                        legacy?.mode !== option
                      }
                      onClick={() => setMode(option)}
                    >
                      {option[0].toUpperCase() + option.slice(1)}
                    </button>
                  ),
                )}
              </div>
              <Servings value={servings} onChange={setServings} />
              <div className="button-row">
                <button className="button secondary" onClick={save}>
                  {savedId ? "Update saved recipe" : "Save recipe"}
                </button>
                <button
                  className="button primary"
                  onClick={() => setCooking(true)}
                >
                  Cook
                </button>
              </div>
            </div>
            <section className="recipe-title">
              <h3>{displayed.title}</h3>
              {adaptation && (
                <p className="muted">
                  {adaptation.provider === "sample"
                    ? "Previously saved sample"
                    : "AI-generated proposal"}{" "}
                  · approximately {adaptation.minutes} minutes · not
                  taste-tested
                </p>
              )}
            </section>
            <div className="recipe-layout">
              <section className="panel">
                <h3>Ingredients</h3>
                <ul className="ingredient-list">
                  {displayed.ingredients.map((item) => (
                    <li key={item.id}>{ingredientLabel(item)}</li>
                  ))}
                </ul>
              </section>
              <section className="panel">
                <h3>Instructions</h3>
                <ol className="instructions">
                  {displayed.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              </section>
            </div>
            {adaptation && (
              <>
                <section className="panel">
                  <h3>Why these changes</h3>
                  {adaptation.flavour && (
                    <p>
                      <strong>Flavour:</strong> {adaptation.flavour}
                    </p>
                  )}
                  {adaptation.texture && (
                    <p>
                      <strong>Texture:</strong> {adaptation.texture}
                    </p>
                  )}
                  {adaptation.macroNotes && (
                    <p>
                      <strong>Macros:</strong> {adaptation.macroNotes}
                    </p>
                  )}
                  <div className="change-list">
                    {adaptation.changes.map((change, index) => (
                      <article key={index}>
                        <h4>
                          {change.original} → {change.replacement}
                        </h4>
                        <p>{change.reason}</p>
                      </article>
                    ))}
                  </div>
                  {adaptation.stepChanges?.length ? (
                    <details>
                      <summary>Changes to the original cooking method</summary>
                      <ul>
                        {adaptation.stepChanges.map((step, index) => (
                          <li key={index}>
                            Original step {step.originalStep}: {step.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
                <section className="panel">
                  <h3>Tradeoffs and checks</h3>
                  <ul>
                    {adaptation.tradeoffs.map((tradeoff, index) => (
                      <li key={index}>{tradeoff}</li>
                    ))}
                  </ul>
                </section>
              </>
            )}
            {bundle && (
              <>
                <Nutrition bundle={bundle} />
                <details className="panel">
                  <summary>
                    Ingredient roles and alternatives considered
                  </summary>
                  {bundle.ingredientAnalysis.map((analysis, index) => (
                    <article className="analysis" key={index}>
                      <h4>{analysis.ingredient}</h4>
                      <p className="muted">{analysis.roles.join(", ")}</p>
                      <p>{analysis.contribution}</p>
                      <p>{analysis.approach}</p>
                      <ul>
                        {analysis.alternativesConsidered.map(
                          (alternative, i) => (
                            <li key={i}>{alternative}</li>
                          ),
                        )}
                      </ul>
                    </article>
                  ))}
                </details>
                <section className="panel">
                  <h3>Research sources</h3>
                  {bundle.sources.length ? (
                    <ul>
                      {bundle.sources.map((item, index) => (
                        <li key={index}>
                          <a href={item.url} target="_blank" rel="noreferrer">
                            {item.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No web sources were returned for this adaptation.
                    </p>
                  )}
                  {bundle.notes.length ? (
                    <ul>
                      {bundle.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </>
            )}
          </>
        )}
      </main>
      <footer>
        <button className="text-button" onClick={() => setInstallOpen(true)}>
          Add to iPhone Home Screen
        </button>
        <span>Recipes are saved in this browser.</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {connectionOpen && (
        <Dialog title="AI connection" onClose={() => setConnectionOpen(false)}>
          {status?.provider === "chatgpt" ? (
            <>
              <p>
                {status.session?.sharing
                  ? "Using your ChatGPT plan."
                  : "Sign in with ChatGPT on your Windows desktop, and approve plan usage for Vegetate."}
              </p>
              {status.session?.identity && (
                <p className="muted">
                  {status.session.identity.name ||
                    status.session.identity.email}
                </p>
              )}
              {status.local ? (
                <>
                  <div className="button-row">
                    <button
                      className="button primary"
                      disabled={status.session?.status === "connecting"}
                      onClick={signIn}
                    >
                      {status.session?.status === "connecting"
                        ? "Complete sign-in in your browser…"
                        : status.session?.status === "connected" &&
                            !status.session.sharing
                          ? "Enable ChatGPT plan usage"
                          : "Sign in with ChatGPT"}
                    </button>
                    {status.session?.status === "connected" && (
                      <button className="button secondary" onClick={signOut}>
                        Sign out
                      </button>
                    )}
                  </div>
                  {status.publicUrl && (
                    <p>
                      iPhone address:{" "}
                      <a href={status.publicUrl}>{status.publicUrl}</a>
                    </p>
                  )}
                  {status.pairingCode && (
                    <p>
                      iPhone pairing code:{" "}
                      <strong className="pairing-code">
                        {status.pairingCode}
                      </strong>
                    </p>
                  )}
                  <p className="muted">
                    Open the private iPhone address while connected to
                    Tailscale, then enter this pairing code. Keep the desktop
                    running.
                  </p>
                </>
              ) : (
                <p className="muted">
                  Manage ChatGPT sign-in on the Windows desktop. Pair this phone
                  using the code displayed there.
                </p>
              )}
              {status.session?.error && (
                <p className="error" role="alert">
                  {status.session.error}
                </p>
              )}
              <p>
                <a
                  href="https://chatgpt.com/settings/usage"
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage ChatGPT usage
                </a>
              </p>
            </>
          ) : (
            <p>
              {status?.configured
                ? "The AI service is configured. Enter your app access code to use it."
                : "Automatic AI is not configured for this site yet. No live extraction or adaptation requests can run until the connection is set up."}
            </p>
          )}
          {statusError && <p className="error">{statusError}</p>}
          {status?.configured && !status.local && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label htmlFor="access-code">
                {status.provider === "chatgpt"
                  ? "Desktop pairing code"
                  : "App access code"}
              </label>
              <input
                id="access-code"
                type="password"
                autoComplete="current-password"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
              />
              {connectionError && (
                <p className="error" role="alert">
                  {connectionError}
                </p>
              )}
              <div className="button-row">
                <button className="button primary" type="submit">
                  Unlock AI
                </button>
                {code && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setCode("");
                      setCodeInput("");
                      try {
                        sessionStorage.removeItem("vegetate.access-code");
                      } catch {
                        /* Storage may be disabled. */
                      }
                      setConnectionOpen(false);
                    }}
                  >
                    Disconnect this browser
                  </button>
                )}
              </div>
            </form>
          )}
          {status?.models?.length ? (
            <div>
              <label htmlFor="model">ChatGPT model</label>
              <select
                id="model"
                value={status.model}
                onChange={(event) => void changeModel(event.target.value)}
              >
                {status.models.map((model) => (
                  <option key={model.slug} value={model.slug}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {connectionError && status?.local && (
            <p className="error" role="alert">
              {connectionError}
            </p>
          )}
          <button className="text-button" onClick={() => void refreshStatus()}>
            Refresh connection status
          </button>
        </Dialog>
      )}
      {notebookOpen && (
        <Dialog title="Saved recipes" onClose={() => setNotebookOpen(false)}>
          <p className="muted">
            Stored on this browser and device. Export a backup before clearing
            site data.
          </p>
          {initial.error && (
            <p className="error" role="alert">
              {initial.error}
            </p>
          )}
          {!entries.length ? (
            <p>No saved recipes yet.</p>
          ) : (
            <>
              <ul className="saved-list">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <button
                      className="saved-entry"
                      onClick={() => openEntry(entry)}
                    >
                      <strong>{entry.original.title}</strong>
                      <span>
                        {entry.bundle
                          ? "Original + vegetarian + vegan"
                          : entry.adaptation
                            ? `${entry.adaptation.mode} adaptation`
                            : "Original recipe"}{" "}
                        · {entry.servings} servings
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${entry.original.title}`}
                      onClick={() => removeEntry(entry.id)}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
              <button className="button secondary" onClick={exportEntries}>
                Export saved recipes
              </button>
            </>
          )}
          <input
            ref={importFile}
            type="file"
            accept="application/json,.json"
            aria-label="Import saved recipes file"
            hidden
            onChange={(event) => void importEntries(event.target.files?.[0])}
          />
          <button
            className="button secondary"
            onClick={() => importFile.current?.click()}
          >
            Import saved recipes
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {installOpen && (
        <Dialog title="Install on iPhone" onClose={() => setInstallOpen(false)}>
          <ol>
            <li>Open the app’s HTTPS address in Safari.</li>
            <li>Tap Share → Add to Home Screen.</li>
            <li>Enable Open as Web App if shown, then tap Add.</li>
          </ol>
          <p>
            Previously saved recipes work offline after the app has loaded. AI
            extraction and adaptation require a connection.
          </p>
        </Dialog>
      )}
      {cooking && displayed && (
        <Cook recipe={displayed} onClose={() => setCooking(false)} />
      )}
    </div>
  );
}
