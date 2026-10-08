import { afterEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const writeFile = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: (...a: unknown[]) => writeFile(...a) }));

import { saveText } from "./saveFile";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  save.mockReset();
  writeFile.mockReset();
});

describe("saveFile (desktop)", () => {
  const FILTERS = [{ name: "CSV", extensions: ["csv"] }];

  it("asks where to save and writes the bytes there", async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    save.mockResolvedValue("C:\\Users\\Julio\\Desktop\\contatos.csv");

    const path = await saveText("contatos.csv", "a;b", FILTERS, "text/csv");

    expect(path).toBe("C:\\Users\\Julio\\Desktop\\contatos.csv");
    expect(save).toHaveBeenCalledWith({ defaultPath: "contatos.csv", filters: FILTERS });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(writeFile.mock.calls[0][1])).toBe("a;b");
  });

  it("does nothing when the user cancels the dialog", async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    save.mockResolvedValue(null);

    expect(await saveText("x.csv", "a", FILTERS, "text/csv")).toBeNull();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
