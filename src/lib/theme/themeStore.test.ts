import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The store keeps module-level state — the subscriber set and the
 * blocked-storage fallback — so each test imports a fresh copy rather than
 * inheriting whatever the previous one left behind.
 */
const freshStore = async (options: {
  readonly storage?: Pick<Storage, "getItem" | "setItem"> | "blocked";
}) => {
  const events = new Map<string, Set<() => void>>();
  const windowStub = {
    addEventListener: (type: string, listener: () => void) => {
      const listeners = events.get(type) ?? new Set<() => void>();
      listeners.add(listener);
      events.set(type, listeners);
    },
    removeEventListener: (type: string, listener: () => void) => {
      events.get(type)?.delete(listener);
    },
  };

  const blocked = {
    getItem: () => {
      throw new Error("The operation is insecure.");
    },
    setItem: () => {
      throw new Error("The operation is insecure.");
    },
  };

  const store = new Map<string, string>();
  const working = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };

  const storage =
    options.storage === "blocked" ? blocked : (options.storage ?? working);

  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", windowStub);

  return { module: await import("./themeStore"), events, store };
};

const root = () => ({ dataset: {} as { theme?: string } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readTheme", () => {
  it("returns a stored choice", async () => {
    const { module, store } = await freshStore({});
    store.set("theme", "dark");

    expect(module.readTheme()).toBe("dark");
  });

  it("falls back to system when nothing is stored", async () => {
    const { module } = await freshStore({});

    expect(module.readTheme()).toBe("system");
  });

  it("ignores a stored value that is not a theme", async () => {
    const { module, store } = await freshStore({});
    store.set("theme", "midnight");

    expect(module.readTheme()).toBe("system");
  });
});

describe("readServerTheme", () => {
  it("is the default, because the server cannot see a browser's storage", async () => {
    const { module } = await freshStore({});

    expect(module.readServerTheme()).toBe("system");
  });
});

describe("chooseTheme", () => {
  it("applies the choice to the document root", async () => {
    const { module } = await freshStore({});
    const element = root();

    module.chooseTheme("dark", element);
    expect(element.dataset.theme).toBe("dark");

    module.chooseTheme("system", element);
    expect(element.dataset.theme).toBeUndefined();
  });

  it("persists the choice", async () => {
    const { module, store } = await freshStore({});

    module.chooseTheme("light", root());

    expect(store.get("theme")).toBe("light");
    expect(module.readTheme()).toBe("light");
  });

  it("tells every subscriber", async () => {
    const { module } = await freshStore({});
    let notified = 0;
    module.subscribeToTheme(() => {
      notified += 1;
    });

    module.chooseTheme("dark", root());

    expect(notified).toBe(1);
  });

  it("still switches when the browser blocks site data", async () => {
    // A private window throws on both read and write. Refusing to switch would
    // be a worse answer than switching and forgetting.
    const { module } = await freshStore({ storage: "blocked" });
    const element = root();

    module.chooseTheme("dark", element);

    expect(element.dataset.theme).toBe("dark");
    // And the control agrees, rather than showing the old option as selected.
    expect(module.readTheme()).toBe("dark");
  });
});

describe("subscribeToTheme", () => {
  it("follows a choice made in another tab", async () => {
    // `storage` only fires in other tabs, which is exactly the case worth covering.
    const { module, events } = await freshStore({});
    let notified = 0;

    module.subscribeToTheme(() => {
      notified += 1;
    });

    for (const listener of events.get("storage") ?? []) listener();

    expect(notified).toBe(1);
  });

  it("stops listening once unsubscribed", async () => {
    const { module, events } = await freshStore({});
    let notified = 0;

    const unsubscribe = module.subscribeToTheme(() => {
      notified += 1;
    });
    unsubscribe();

    module.chooseTheme("dark", root());
    for (const listener of events.get("storage") ?? []) listener();

    expect(notified).toBe(0);
  });
});
