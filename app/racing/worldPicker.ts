import { defaultSeed, isPreset, normalizeSeed } from "./worldGenerator.ts";
import { worldOptions, worldURL, type WorldChoice } from "./worldSelection.ts";

const favoriteKey = "little-machines-favorite-worlds-v1";

function readFavorites(): WorldChoice[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(favoriteKey) ?? "[]");
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => entry && worldOptions.some(({ id }) => entry.id === id)
      && (!isPreset(entry.id) || typeof entry.seed === "string")).slice(0, 20);
  } catch { return []; }
}

export function setupWorldPicker(current: WorldChoice) {
  const button = document.querySelector<HTMLButtonElement>("#choose-world")!;
  const dialog = document.querySelector<HTMLDialogElement>("#world-picker")!;
  const form = dialog.querySelector("form")!;
  const select = dialog.querySelector<HTMLSelectElement>("#world-name")!;
  const seed = dialog.querySelector<HTMLInputElement>("#world-seed")!;
  const link = dialog.querySelector<HTMLInputElement>("#world-link")!;
  const favorites = dialog.querySelector<HTMLSelectElement>("#world-favorites")!;
  const status = dialog.querySelector<HTMLElement>("#world-message")!;
  const random = dialog.querySelector<HTMLButtonElement>("#world-random")!;
  const copySeed = dialog.querySelector<HTMLButtonElement>("#world-copy-seed")!;
  const favorite = dialog.querySelector<HTMLButtonElement>("#world-favorite")!;
  let saved = readFavorites();

  const nameOf = (id: string) => worldOptions.find((option) => option.id === id)?.name ?? id;
  const choice = (): WorldChoice => ({ id: select.value, ...(isPreset(select.value) ? { seed: normalizeSeed(seed.value) } : {}) });
  const linkOf = (entry: WorldChoice) => worldURL(entry, location.href).href;
  const savedIndex = () => saved.findIndex((entry) => linkOf(entry) === link.value);
  function update() {
    const procedural = isPreset(select.value);
    seed.disabled = random.disabled = copySeed.disabled = !procedural;
    link.value = linkOf(choice());
    favorite.textContent = savedIndex() < 0 ? "Lagre favoritt" : "Fjern favoritt";
  }
  function refreshFavorites() {
    favorites.replaceChildren(new Option(saved.length ? "Velg favoritt" : "Ingen favoritter ennå", ""));
    saved.forEach((entry, i) => favorites.add(new Option(`${nameOf(entry.id)}${entry.seed ? ` · ${entry.seed}` : ""}`, String(i))));
  }
  function show(entry: WorldChoice) {
    select.value = entry.id;
    seed.value = entry.seed ?? defaultSeed;
    update();
  }
  async function copy(input: HTMLInputElement, label: string) {
    try {
      await navigator.clipboard.writeText(input === seed ? normalizeSeed(input.value) : input.value);
      status.textContent = `${label} kopiert.`;
    } catch {
      input.focus();
      input.select();
      status.textContent = `Kopier ${label.toLowerCase()} manuelt.`;
    }
  }

  for (const option of worldOptions) select.add(new Option(option.name, option.id));
  document.querySelector("h1")!.textContent = nameOf(current.id);
  button.hidden = false;
  button.onclick = () => { show(current); favorites.value = ""; status.textContent = ""; dialog.showModal(); };
  form.onsubmit = (event) => { event.preventDefault(); location.assign(link.value); };
  dialog.querySelector<HTMLButtonElement>("#world-close")!.onclick = () => dialog.close();
  select.onchange = update;
  seed.oninput = update;
  random.onclick = () => {
    seed.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
    update();
    location.assign(link.value);
  };
  copySeed.onclick = () => void copy(seed, "Frø");
  dialog.querySelector<HTMLButtonElement>("#world-copy-link")!.onclick = () => void copy(link, "Lenke");
  favorite.onclick = () => {
    const index = savedIndex();
    const next = index < 0 ? [choice(), ...saved].slice(0, 20) : saved.filter((_, i) => i !== index);
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
      saved = next;
      refreshFavorites();
      update();
      status.textContent = index < 0 ? "Favoritt lagret." : "Favoritt fjernet.";
    } catch { status.textContent = "Kunne ikke endre favoritter i denne nettleseren."; }
  };
  favorites.onchange = () => { if (favorites.value) show(saved[Number(favorites.value)]); };
  refreshFavorites();
  return dialog;
}
