import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

const httpFetch = vi.fn();
vi.mock("../../lib/http", () => ({ httpFetch: (...a: unknown[]) => httpFetch(...a) }));

import { setSetting } from "../settings/settings.service";
import {
  completePlace,
  parseCityState,
  placeToCompanyInput,
  searchPlaces,
} from "./googlePlaces.client";

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

beforeEach(async () => {
  db = await createMigratedTestDb();
  await setSetting("google_api_key", "k");
  httpFetch.mockReset();
});

describe("google places", () => {
  it("parses city/state from a BR formatted address", () => {
    expect(parseCityState("Av. X, 10 - Centro, Cuiabá - MT, 78000-000, Brasil")).toEqual({ city: "Cuiabá", state: "MT" });
    expect(parseCityState("sem padrão")).toEqual({});
  });

  it("falls back to legacy API on 403 and maps results to a company", async () => {
    httpFetch.mockImplementation(async (url: string) => {
      if (url.includes("places.googleapis.com"))
        return json(403, { error: { message: "Requests to this API ... are blocked." } });
      if (url.includes("/textsearch/"))
        return json(200, {
          status: "OK",
          results: [{
            place_id: "abc", name: "Auto Center",
            formatted_address: "Av. X, 10 - Centro, Cuiabá - MT, 78000-000, Brasil",
            rating: 4.6, user_ratings_total: 120, types: ["car_dealer"],
          }],
        });
      return json(200, { status: "OK", result: { website: "https://auto.com.br", formatted_phone_number: "(65) 3333-1111" } });
    });

    const found = await searchPlaces("loja de carros em Cuiabá");
    expect(found).toHaveLength(1);
    // a busca legada é barata: telefone/site só vêm depois, para lugares novos
    expect(found[0].websiteUri).toBeUndefined();
    const places = [await completePlace(found[0])];

    const company = placeToCompanyInput(places[0], "loja de carros")!;
    expect(company).toMatchObject({
      name: "Auto Center", city: "Cuiabá", state: "MT",
      website: "https://auto.com.br", googlePlaceId: "abc", reviewsCount: 120,
    });
  });

  it("surfaces legacy REQUEST_DENIED errors and does not fall back on non-403", async () => {
    httpFetch.mockImplementation(async (url: string) =>
      url.includes("places.googleapis.com")
        ? json(403, {})
        : json(200, { status: "REQUEST_DENIED", error_message: "API not enabled" }),
    );
    await expect(searchPlaces("x y")).rejects.toThrow(/REQUEST_DENIED/);

    httpFetch.mockReset();
    httpFetch.mockResolvedValue(json(429, {}));
    await expect(searchPlaces("x y")).rejects.toThrow(/429/);
    expect(httpFetch).toHaveBeenCalledTimes(1);
  });
});
