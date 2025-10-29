import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptNames = ["app-core.js", "app-features.js", "app-init.js"];
const appSources = await Promise.all(
  scriptNames.map((name) =>
    readFile(join(__dirname, "../public/js", name), "utf8")
  )
);

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
  for (let index = 0; index < appSources.length; index += 1) {
    const source = appSources[index];
    const filename = scriptNames[index];
    const script = new vm.Script(source, { filename });
    script.runInContext(context);
  }

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

test("createDeckSnapshot serialises decks with sanitised boards for fast rendering", () => {
  const { createDeckSnapshot } = loadInternals();
  const deck = {
    id: "deck-abc",
    name: "Jeskai Value",
    format: "Commander",
    updatedAt: "2024-04-01T10:00:00Z",
    cardCount: 99,
    url: "https://www.moxfield.com/decks/deck-abc",
    raw: {
      description: "An interactive control list.",
      summary: "Keep the board clear and win with value.",
      synced_at: "2024-04-02T09:00:00Z",
      boards: [
        {
          name: "mainboard",
          count: 3,
          cards: [
            {
              quantity: 2,
              card: {
                id: "card-001",
                name: "Mulldrifter",
                mana_cost: "{4}{U}",
                type_line: "Creature — Elemental",
                oracle_text: "Flying\nWhen Mulldrifter enters the battlefield, draw two cards.",
                power: "2",
                toughness: "2",
                color_identity: ["U"],
                prices: { usd: "0.35", eur: "0.28", foil: "1.20" },
                faces: [{ name: "Mulldrifter", oracle_text: "Flying" }],
                extraneous: "remove me",
              },
            },
            {
              quantity: 1,
              card: {
                card_id: "card-002",
                name: "Supreme Verdict",
                mana_cost: "{1}{W}{W}{U}",
                type_line: "Sorcery",
                oracle_text: "Supreme Verdict can't be countered.\nDestroy all creatures.",
              },
            },
          ],
        },
      ],
    },
  };

  const snapshot = createDeckSnapshot(deck, { handle: " SnapshotUser " });

  assert.equal(snapshot.deckId, "deck-abc");
  assert.equal(snapshot.handle, "SnapshotUser");
  assert.ok(Array.isArray(snapshot.deck.raw.boards));
  assert.equal(snapshot.deck.raw.boards.length, 1);
  assert.equal(snapshot.deck.raw.boards[0].cards.length, 2);
  assert.equal(snapshot.deck.raw.boards[0].cards[0].quantity, 2);
  assert.equal(snapshot.deck.raw.boards[0].cards[0].card.name, "Mulldrifter");
  assert.equal(snapshot.deck.raw.boards[0].cards[1].card.name, "Supreme Verdict");
  assert.ok(!("extraneous" in snapshot.deck.raw.boards[0].cards[0].card));
  assert.ok(!("foil" in snapshot.deck.raw.boards[0].cards[0].card.prices));
  assert.equal(snapshot.deck.raw.description, "An interactive control list.");
  assert.equal(snapshot.deck.raw.synced_at, "2024-04-02T09:00:00Z");
});

test("collectDeckBoards normalises board dictionaries from Moxfield", () => {
  const { collectDeckBoards } = loadInternals();
  const deck = {
    raw: {
      boards: {
        commanders: {
          count: 2,
          cards: {
            "card-1": {
              quantity: 1,
              card: {
                name: "Brago, King Eternal",
                color_identity: ["W", "U"],
              },
            },
            "card-2": {
              quantity: 1,
              card: {
                name: "Thrasios, Triton Hero",
                color_identity: ["G", "U"],
              },
            },
          },
        },
        mainboard: {
          cards: {
            "card-3": {
              quantity: 3,
              card: {
                name: "Sol Ring",
                color_identity: [],
              },
            },
          },
        },
      },
    },
  };

  const boards = collectDeckBoards(deck);
  assert.equal(Array.isArray(boards), true);
  assert.equal(boards.length, 2);
  const commanderBoard = boards.find((board) => board.name === "commanders");
  assert.ok(commanderBoard, "expected commanders board to be normalised");
  assert.equal(commanderBoard.count, 2);
  assert.equal(commanderBoard.cards.length, 2);
  assert.equal(commanderBoard.cards[0].card.name, "Brago, King Eternal");
  assert.equal(commanderBoard.cards[1].quantity, 1);
});

test("resolveDeckColorIdentity prioritises commander colour identity", () => {
  const { resolveDeckColorIdentity } = loadInternals();
  const deck = {
    raw: {
      colors: ["R", "G"],
      boards: {
        commanders: {
          cards: {
            lead: {
              quantity: 1,
              card: {
                name: "Atraxa, Praetors' Voice",
                color_identity: ["W", "U", "B", "G"],
              },
            },
          },
        },
        mainboard: {
          cards: {
            splash: {
              quantity: 1,
              card: {
                name: "Mountain",
                color_identity: ["R"],
              },
            },
          },
        },
      },
    },
  };

  const colors = resolveDeckColorIdentity(deck);
  assert.equal(colors.length, 4);
  assert.equal(colors.join(","), "W,U,B,G");
});

test("resolveDeckColorIdentity returns colourless when commanders lack colours", () => {
  const { resolveDeckColorIdentity } = loadInternals();
  const deck = {
    raw: {
      boards: {
        commanders: {
          cards: {
            lead: {
              quantity: 1,
              card: {
                name: "Kozilek, the Great Distortion",
                color_identity: [],
              },
            },
          },
        },
      },
    },
  };

  const colors = resolveDeckColorIdentity(deck);
  assert.equal(colors.length, 1);
  assert.equal(colors[0], "C");
});

test("doesDeckMatchSearch matches card names inside deck boards", () => {
  const { doesDeckMatchSearch, normalizeText } = loadInternals();
  const manaCryptDeck = {
    name: "Artifacts",
    raw: {
      boards: {
        mainboard: {
          cards: {
            accel: {
              quantity: 1,
              card: {
                name: "Mana Crypt",
                color_identity: [],
              },
            },
          },
        },
      },
    },
  };
  const rampDeck = {
    name: "Ramp Up",
    raw: {
      boards: {
        mainboard: {
          cards: {
            accel: {
              quantity: 1,
              card: {
                name: "Cultivate",
                color_identity: ["G"],
              },
            },
          },
        },
      },
    },
  };

  const query = normalizeText("crypt");
  assert.equal(doesDeckMatchSearch(manaCryptDeck, query), true);
  assert.equal(doesDeckMatchSearch(rampDeck, query), false);
});
