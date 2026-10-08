import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

import { importCompany } from "./company.service";
import { searchCompaniesRepository } from "./company.repository";

describe("global search", () => {
  beforeEach(async () => {
    await createMigratedTestDb();
    await importCompany({ name: "Clínica Sorriso", city: "Cuiabá" }, "MANUAL");
    await importCompany({ name: "Auto Center Prime", city: "Cuiabá" }, "MANUAL");
  });

  it("finds by part of the name, ignoring case; short terms and wildcards are safe", async () => {
    expect((await searchCompaniesRepository("sorri")).map((r) => r.name)).toEqual(["Clínica Sorriso"]);
    expect(await searchCompaniesRepository("a")).toEqual([]);
    expect(await searchCompaniesRepository("%%")).toEqual([]);
    expect((await searchCompaniesRepository("CENTER")).length).toBe(1);
  });
});
