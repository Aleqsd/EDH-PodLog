import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appPath = join(__dirname, "../public/js/app.js");
const appSource = await readFile(appPath, "utf8");

const createLocalStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
};

const loadInternals = () => {
  const localStorage = createLocalStorage();
  const documentStub = {
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    body: { dataset: {} },
  };

  const windowStub = {
    EDH_PODLOG_CONFIG: {},
    addEventListener: () => {},
    dispatchEvent: () => {},
    location: { href: "http://localhost/" },
  };

  const context = {
    window: windowStub,
    document: documentStub,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Intl,
    AbortController,
    fetch,
    Event,
  };
  windowStub.document = documentStub;
  windowStub.localStorage = localStorage;

  context.globalThis = context.window;
  context.self = context.window;

  vm.createContext(context);
  const script = new vm.Script(appSource, { filename: "app.js" });
  script.runInContext(context);

  return context.window.EDH_PODLOG_INTERNAL;
};

test("validateMoxfieldHandle accepts valid usernames", () => {
  const { validateMoxfieldHandle } = loadInternals();
  assert.ok(validateMoxfieldHandle("Player_One").valid);
  assert.ok(validateMoxfieldHandle("DeckMaster-99").valid);
});

test("validateMoxfieldHandle rejects invalid usernames", () => {
  const { validateMoxfieldHandle } = loadInternals();
  assert.equal(validateMoxfieldHandle("").valid, false);
  assert.equal(validateMoxfieldHandle("p").valid, false);
  assert.equal(validateMoxfieldHandle("with space").valid, false);
  assert.equal(validateMoxfieldHandle("player!").valid, false);
});

test("normalizeMoxfieldDeck extracts metadata from backend payloads", () => {
  const { normalizeMoxfieldDeck } = loadInternals();
  const normalized = normalizeMoxfieldDeck({
    public_id: "abc123",
    name: "Rakdos Artifacts",
    format_name: "Commander",
    public_url: "https://www.moxfield.com/decks/abc123",
    last_updated_at: "2023-10-01T12:00:00Z",
    boards: [
      {
        name: "mainboard",
        cards: [
          { quantity: 2, card: {} },
          { quantity: 3, card: {} },
        ],
      },
    ],
  });

  assert.equal(normalized.slug, "abc123");
  assert.equal(normalized.url, "https://www.moxfield.com/decks/abc123");
  assert.equal(normalized.format, "Commander");
  assert.equal(normalized.cardCount, 5);
  assert.equal(normalized.updatedAt, "2023-10-01T12:00:00Z");
});

test("createCardSnapshot preserves core card data for fast detail rendering", () => {
  const { createCardSnapshot } = loadInternals();
  const deck = { publicId: "deck-123", name: "Esper Control", format: "Commander" };
  const board = { name: "mainboard" };
  const entry = {
    quantity: 3,
    card: {
      id: "card-001",
      name: "Mulldrifter",
      mana_cost: "{4}{U}",
      type_line: "Creature — Elemental",
      oracle_text: "Flying\nWhen Mulldrifter enters the battlefield, draw two cards.",
      power: "2",
      toughness: "2",
      color_identity: ["U"],
      set_name: "Lorwyn",
      set: "lrw",
      cn: "72",
      prices: { usd: "0.35", eur: "0.28", foil: "1.20" },
      faces: [{ name: "Mulldrifter", oracle_text: "Flying" }],
      extra_field: "should be stripped",
    },
  };

  const snapshot = createCardSnapshot(deck, board, entry, { handle: "cardPlayer" });

  assert.equal(snapshot.deckId, "deck-123");
  assert.equal(snapshot.cardId, "card-001");
  assert.equal(snapshot.handle, "cardPlayer");
  assert.equal(snapshot.deck.name, "Esper Control");
  assert.equal(snapshot.board.name, "mainboard");
  assert.equal(snapshot.entry.quantity, 3);
  assert.equal(snapshot.entry.card.name, "Mulldrifter");
  assert.equal(snapshot.entry.card.prices.usd, "0.35");
  assert.equal(snapshot.entry.card.prices.eur, "0.28");
  assert.ok(!("foil" in snapshot.entry.card.prices));
  assert.ok(!("extra_field" in snapshot.entry.card));
});
