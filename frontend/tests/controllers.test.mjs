import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_SCRIPTS = [
  "../public/js/app-core.js",
  "../public/js/app-features.js",
  "../public/js/app-init.js",
];

const STORAGE_KEY = "edhPodlogSession";

class MockClassList {
  constructor(owner) {
    this._owner = owner;
  }

  add(...tokens) {
    tokens.forEach((token) => {
      if (token) {
        this._owner._classList.add(token);
      }
    });
  }

  remove(...tokens) {
    tokens.forEach((token) => this._owner._classList.delete(token));
  }

  contains(token) {
    return this._owner._classList.has(token);
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.contains(token)) {
        this.remove(token);
        return false;
      }
      this.add(token);
      return true;
    }
    if (force) {
      this.add(token);
      return true;
    }
    this.remove(token);
    return false;
  }
}

class MockElement {
  constructor(tagName, { id, className, textContent } = {}) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = null;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.eventListeners = new Map();
    this.innerHTML = "";
    this._textContent = textContent ?? "";
    this._classList = new Set();
    this.classList = new MockClassList(this);
    this._id = "";
    if (className) {
      this.className = className;
    }
    if (id) {
      this.id = id;
    }
  }

  get id() {
    return this._id;
  }

  set id(value) {
    const next = value ? String(value) : "";
    if (this.ownerDocument && this._id) {
      this.ownerDocument._unregisterId(this._id, this);
    }
    this._id = next;
    if (this.ownerDocument && this._id) {
      this.ownerDocument._registerId(this._id, this);
    }
  }

  get className() {
    return Array.from(this._classList).join(" ");
  }

  set className(value) {
    this._classList.clear();
    if (typeof value === "string") {
      value
        .split(/\s+/u)
        .filter(Boolean)
        .forEach((token) => this._classList.add(token));
    }
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value == null ? "" : String(value);
  }

  addEventListener(type, handler) {
    const listeners = this.eventListeners.get(type) ?? [];
    listeners.push(handler);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(type, handler) {
    const listeners = this.eventListeners.get(type);
    if (!listeners) {
      return;
    }
    const index = listeners.indexOf(handler);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  dispatchEvent(event) {
    const type = event?.type ?? event;
    const listeners = this.eventListeners.get(type) ?? [];
    for (const listener of listeners) {
      listener.call(this, event);
    }
    return true;
  }

  appendChild(child) {
    if (!(child instanceof MockElement)) {
      throw new TypeError("MockElement only supports MockElement children.");
    }
    child.parentNode = this;
    if (this.ownerDocument && child.ownerDocument !== this.ownerDocument) {
      this.ownerDocument.registerElement(child);
    }
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name, value) {
    if (name === "class") {
      this.className = String(value);
    }
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === "class") {
      return this.className;
    }
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    if (name === "class") {
      this.className = "";
    }
    this.attributes.delete(name);
  }

  _matchesSelector(selector) {
    if (selector.startsWith("#")) {
      return this.id === selector.slice(1);
    }
    if (selector.startsWith(".")) {
      return this.classList.contains(selector.slice(1));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  _querySelectorInternal(parts, index) {
    if (index >= parts.length) {
      return null;
    }
    const selector = parts[index];
    for (const child of this.children) {
      if (child._matchesSelector(selector)) {
        if (index === parts.length - 1) {
          return child;
        }
        const descendant = child._querySelectorInternal(parts, index + 1);
        if (descendant) {
          return descendant;
        }
      }
      const nested = child._querySelectorInternal(parts, index);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  querySelector(selector) {
    if (!selector) {
      return null;
    }
    const parts = selector.trim().split(/\s+/u);
    return this._querySelectorInternal(parts, 0);
  }
}

class MockDocument {
  constructor({ bodyDataset = {}, bodyClasses = [] } = {}) {
    this._elementsById = new Map();
    this._listeners = new Map();
    this._querySelectors = new Map();
    this.body = new MockElement("body");
    this.body.ownerDocument = this;
    this.body.dataset = { ...bodyDataset };
    bodyClasses.forEach((token) => this.body.classList.add(token));
  }

  _registerId(id, element) {
    this._elementsById.set(id, element);
  }

  _unregisterId(id, element) {
    const current = this._elementsById.get(id);
    if (current === element) {
      this._elementsById.delete(id);
    }
  }

  registerElement(element, id) {
    if (!(element instanceof MockElement)) {
      throw new TypeError("Expected MockElement.");
    }
    element.ownerDocument = this;
    if (typeof id === "string") {
      element.id = id;
    } else if (element.id) {
      this._registerId(element.id, element);
    }
    return element;
  }

  createElement(tagName) {
    const element = new MockElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  getElementById(id) {
    return this._elementsById.get(id) ?? null;
  }

  querySelector(selector) {
    if (this._querySelectors.has(selector)) {
      return this._querySelectors.get(selector);
    }
    return this.body.querySelector(selector);
  }

  setQuerySelector(selector, element) {
    this._querySelectors.set(selector, element);
    if (element instanceof MockElement && !element.ownerDocument) {
      this.registerElement(element);
    }
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) ?? [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this._listeners.get(type);
    if (!listeners) {
      return;
    }
    const index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
  }

  async dispatchEvent(event) {
    const type = event?.type ?? event;
    const listeners = this._listeners.get(type) ?? [];
    for (const listener of listeners) {
      const result = listener.call(this, event);
      if (result && typeof result.then === "function") {
        await result;
      }
    }
    return true;
  }
}

const createElement = (tagName, options) => new MockElement(tagName, options);

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

const runScriptsInContext = async (context, extraScripts) => {
  const scriptPaths = [...BASE_SCRIPTS, ...extraScripts];
  for (const relativePath of scriptPaths) {
    const source = await readFile(join(__dirname, relativePath), "utf8");
    const script = new vm.Script(source, { filename: relativePath });
    script.runInContext(context);
  }
};

const setupControllerRuntime = async ({
  page,
  requireAuth = false,
  session = null,
  elementsById = {},
  querySelectors = {},
  controllerScripts = [],
  loadCachedDecksForHandle = null,
}) => {
  const document = new MockDocument({ bodyDataset: { page, requireAuth: String(requireAuth) } });

  for (const [id, element] of Object.entries(elementsById)) {
    document.registerElement(element, id);
  }

  for (const [selector, element] of Object.entries(querySelectors)) {
    document.setQuerySelector(selector, element);
  }

  const localStorage = createLocalStorage();
  const sessionStorage = createLocalStorage();

  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  const windowStub = {
    EDH_PODLOG_CONFIG: {},
    EDH_PODLOG: {},
    document,
    localStorage,
    sessionStorage,
    location: { href: "http://localhost/" },
    history: { replaceState: () => {}, pushState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    alert: () => {},
    confirm: () => true,
  };

  const context = {
    window: windowStub,
    document,
    localStorage,
    sessionStorage,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    AbortController,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    Event,
  };

  windowStub.document = document;
  windowStub.localStorage = localStorage;
  windowStub.sessionStorage = sessionStorage;
  document.defaultView = windowStub;

  windowStub.EDH_PODLOG.loadCachedDecksForHandle =
    typeof loadCachedDecksForHandle === "function"
      ? loadCachedDecksForHandle
      : () => {};

  context.globalThis = windowStub;
  context.self = windowStub;

  const vmContext = vm.createContext(context);
  await runScriptsInContext(vmContext, controllerScripts);

  const readyEvent = new Event("DOMContentLoaded");
  await document.dispatchEvent(readyEvent);

  return {
    window: windowStub,
    document,
  };
};

test("landing controller primes sign-in button state when Google config is missing", async () => {
  const signInButton = createElement("button");
  const signInLabel = createElement("span", { textContent: "Connexion" });
  signInButton.appendChild(signInLabel);
  const footnote = createElement("span", { className: "footnote-text", textContent: "Footnote" });
  const footerYear = createElement("span", { textContent: "2000" });

  const { document } = await setupControllerRuntime({
    page: "landing",
    elementsById: {
      googleSignIn: signInButton,
      footerYear,
    },
    querySelectors: {
      ".signin-footnote .footnote-text": footnote,
    },
    controllerScripts: ["../public/js/controllers/landing.js"],
  });

  assert.equal(signInButton.disabled, true);
  assert.equal(signInButton.classList.contains("is-disabled"), true);
  assert.equal(signInLabel.textContent, "Configurer Google OAuth");
  assert.equal(
    footnote.textContent,
    "Ajoutez votre identifiant client Google dans config.js pour activer la connexion.",
  );
  assert.equal(footerYear.textContent, String(new Date().getFullYear()));

  const listeners = signInButton.eventListeners.get("click") ?? [];
  assert.ok(listeners.length > 0, "expected click handler to be registered");
});

test("decks controller requests cached decks when integration has no local data", async () => {
  const deckCollection = createElement("div");
  const deckCollectionEmpty = createElement("div");
  const deckStatus = createElement("div");
  const deckBulkDelete = createElement("button");

  const session = {
    user: { display_name: "Deck Tester" },
    integrations: {
      moxfield: {
        handle: "TestHandle",
        decks: [],
      },
    },
  };

  let calledWithHandle = null;
  const { window } = await setupControllerRuntime({
    page: "decks",
    session,
    elementsById: {
      deckCollection,
      deckCollectionEmpty,
      deckStatus,
      deckBulkDelete,
    },
    controllerScripts: ["../public/js/controllers/decks.js"],
    loadCachedDecksForHandle(handle) {
      calledWithHandle = handle;
    },
  });

  assert.equal(calledWithHandle, "TestHandle");
  assert.equal(deckCollection.innerHTML, "");
  assert.equal(deckCollectionEmpty.classList.contains("is-visible"), true);
  assert.equal(deckBulkDelete.disabled, true);
  assert.equal(deckBulkDelete.classList.contains("is-hidden"), true);
});
