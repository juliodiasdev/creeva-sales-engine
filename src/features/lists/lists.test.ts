import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { importPlaces, buildListName } from "../discovery/discovery.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { extractWebsiteFacts } from "../enrichment/website.facts";
import { ensureServicesSeed } from "../services/services.service";
import { setSetting } from "../settings/settings.service";
import { createListRepository } from "./lists.repository";
import {
  countStages,
  discardCompanies,
  getProcessOverview,
  loadListItems,
  loadListsWithStats,
  nextStep,
  qualifyCompanies,
  recommendedToQualify,
  restoreCompanies,
  startOutreach,
} from "./lists.service";
import { runRepairsOnce } from "../maintenance/repair.service";
import { importCompany } from "../companies/company.service";

const place = (id: string, name: string, extra = {}) => ({
  id, displayName: { text: name }, formattedAddress: `Rua ${id}, 1 - Centro, Cuiabá - MT, Brasil`,
  nationalPhoneNumber: `(65) 9${String(1000 + id.charCodeAt(0)).slice(-4)}-${String(2000 + id.charCodeAt(0)).slice(-4)}`, websiteUri: `https://${id}.com.br`, rating: 4.7, userRatingCount: 80,
  googleMapsUri: `https://maps.google.com/?cid=${id}`, businessStatus: "OPERATIONAL", ...extra,
});

const html = `<html><head><meta name="viewport" content="width=device-width"></head><body>sem acao</body></html>`;
const crawler = async (u: string) => extractWebsiteFacts(html, { url: u, finalUrl: u, httpStatus: 200 });

beforeEach(async () => {
  db = await createMigratedTestDb();
  await ensureServicesSeed();
});

async function newList(places: ReturnType<typeof place>[]) {
  const listId = await createListRepository({ name: "Odontologia — Cuiabá · 09/10", segment: "odontologia", city: "Cuiabá", queryText: "q", pages: 1 });
  const result = await importPlaces(places, "odontologia", undefined, listId);
  return { listId, result };
}

describe("a list is a folder of Google Maps companies", () => {
  it("stores ONLY maps data, keeps the maps link, and links companies to the list", async () => {
    const { listId, result } = await newList([place("a", "Clínica A"), place("b", "Clínica B", { businessStatus: "CLOSED_PERMANENTLY" })]);
    expect(result).toMatchObject({ imported: 2, listId });

    const rows = await db.select<{ name: string; list_id: number; maps_url: string; lead_status: string; disqualified_reason: string | null; website: string; email?: string }[]>(
      "SELECT * FROM companies ORDER BY id");
    expect(rows.map((r) => r.list_id)).toEqual([listId, listId]);
    expect(rows[0]).toMatchObject({ maps_url: "https://maps.google.com/?cid=a", lead_status: "DISCOVERED" });
    // fechada no Google Maps: já entra descartada, com motivo
    expect(rows[1]).toMatchObject({ lead_status: "DISQUALIFIED" });
    expect(rows[1].disqualified_reason).toContain("Google Maps");
    // nada de canais/redes inventados antes do enriquecimento
    expect(await db.select("SELECT id FROM company_channels")).toHaveLength(0);
  });

  it("fills the maps link from the place id when Google does not send one", async () => {
    const { listId } = await newList([place("c", "Clínica C", { googleMapsUri: undefined })]);
    const [c] = await db.select<{ maps_url: string }[]>("SELECT maps_url FROM companies WHERE list_id=$1", [listId]);
    expect(c.maps_url).toBe("https://www.google.com/maps/place/?q=place_id:c");
  });

  it("names lists in a readable way", () => {
    expect(buildListName("odontologia", "Cuiabá", undefined, new Date(2026, 9, 9))).toBe("Odontologia — Cuiabá · 09/10");
    expect(buildListName("academia", "Cuiabá", "Jardim Itália", new Date(2026, 9, 9))).toBe("Academia — Jardim Itália, Cuiabá · 09/10");
  });
});

describe("the controlled process: capture → enrich → qualify → outreach", () => {
  it("walks the whole cycle, one decision at a time", async () => {
    const { listId } = await newList([place("a", "Clínica A"), place("b", "Clínica B"), place("c", "Clínica C")]);
    const ids = (await db.select<{ id: number }[]>("SELECT id FROM companies ORDER BY id")).map((r) => r.id);

    let [{ stats, next }] = await loadListsWithStats();
    expect(stats).toMatchObject({ total: 3, discovered: 3 });
    expect(next).toMatchObject({ step: 2, title: "Enriquecer", count: 3 });

    // 2. enriquecer (opt-in): NÃO qualifica sozinho
    await setSetting("min_score", "20");
    for (const id of ids) await enrichCompany(id, crawler);
    [{ stats, next }] = await loadListsWithStats();
    expect(stats).toMatchObject({ enriched: 3, qualified: 0, discovered: 0 });
    expect(next).toMatchObject({ step: 3, title: "Qualificar" });

    // abordar sem qualificar é bloqueado
    expect(await startOutreach(ids)).toEqual({ done: 0, skipped: 3 });
    expect(await db.select("SELECT id FROM prospects")).toHaveLength(0);

    // 3. qualificar: sugestão por pontuação + decisão do usuário
    const items = await loadListItems(listId);
    const suggested = await recommendedToQualify(items);
    expect(suggested.length).toBeGreaterThan(0);

    expect(await discardCompanies([ids[2]], "Fora do perfil")).toEqual({ done: 1, skipped: 0 });
    await expect(discardCompanies([ids[0]], "  ")).rejects.toThrow(/motivo/i);
    expect(await qualifyCompanies([ids[0], ids[1], ids[2]])).toEqual({ done: 2, skipped: 1 }); // a descartada não é qualificada

    [{ stats, next }] = await loadListsWithStats();
    expect(stats).toMatchObject({ qualified: 2, disqualified: 1 });
    expect(next).toMatchObject({ step: 4, title: "Iniciar abordagem" });

    // 4. abordagem: vira prospect + primeira tarefa
    expect(await startOutreach(ids)).toEqual({ done: 2, skipped: 1 });
    expect(await db.select("SELECT id FROM prospects")).toHaveLength(2);
    expect(await db.select("SELECT id FROM tasks WHERE type='FIRST_CONTACT'")).toHaveLength(2);

    [{ stats, next }] = await loadListsWithStats();
    expect(stats).toMatchObject({ ready: 2, qualified: 0 });
    expect(next).toMatchObject({ step: 5, title: "Acompanhar" });

    // descartada pode voltar ao início
    expect(await restoreCompanies(ids)).toEqual({ done: 1, skipped: 2 });
  });

  it("enrichment keeps decisions already made (qualified/discarded are not reset)", async () => {
    const { listId } = await newList([place("a", "Clínica A")]);
    void listId;
    const [{ id }] = await db.select<{ id: number }[]>("SELECT id FROM companies");
    await qualifyCompanies([id]);
    await enrichCompany(id, crawler);
    const [c] = await db.select<{ lead_status: string }[]>("SELECT lead_status FROM companies WHERE id=$1", [id]);
    expect(c.lead_status).toBe("QUALIFIED");
  });

  it("overview points to the list with the most pending work", async () => {
    await newList([place("a", "A"), place("b", "B")]);
    const second = await createListRepository({ name: "Outra", segment: "x", city: "y", queryText: "q", pages: 1 });
    await importPlaces([place("c", "C"), place("d", "D"), place("e", "E")], "x", undefined, second);

    const overview = await getProcessOverview();
    expect(overview).toMatchObject({ openLists: 2, discovered: 5 });
    expect(overview.best.discovered).toBe(second);
  });

  it("next step helper", () => {
    const base = { total: 0, discovered: 0, enriching: 0, enriched: 0, qualified: 0, ready: 0, disqualified: 0 };
    expect(nextStep({ ...base, enriched: 2 }).step).toBe(3);
    expect(nextStep({ ...base, qualified: 1 }).step).toBe(4);
    expect(nextStep({ ...base, disqualified: 5, total: 5 }).title).toBe("Concluída");
    expect(countStages([{ lead_status: "READY" }, { lead_status: "DISCOVERED" }])).toMatchObject({ total: 2, ready: 1, discovered: 1 });
  });
});

describe("legacy companies are organised into lists once", () => {
  it("groups orphans by segment and city", async () => {
    await importCompany({ name: "A1", segment: "odontologia", city: "Cuiabá", address: "x" }, "MANUAL");
    await importCompany({ name: "A2", segment: "odontologia", city: "Cuiabá", address: "y" }, "MANUAL");
    await importCompany({ name: "B1", segment: "academia", city: "Cuiabá", address: "z" }, "MANUAL");

    await runRepairsOnce();
    const lists = await db.select<{ name: string; imported: number }[]>("SELECT name, imported FROM lists ORDER BY id");
    expect(lists.map((l) => l.name)).toEqual(["Odontologia — Cuiabá (anteriores)", "Academia — Cuiabá (anteriores)"]);
    expect(lists.map((l) => l.imported)).toEqual([2, 1]);
    expect(await db.select("SELECT id FROM companies WHERE list_id IS NULL")).toHaveLength(0);
    expect(await runRepairsOnce()).toBeNull();
  });
});
