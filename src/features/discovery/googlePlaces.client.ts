import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";
import { getSetting } from "../settings/settings.service";
import type { CreateCompanyInput } from "../companies/company.types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
].join(",");

interface PlaceComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlaceComponent[];
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
}

/** Converte um resultado do Google em dados de Company (não vira Prospect). */
export function placeToCompanyInput(
  place: GooglePlace,
  segment: string,
): CreateCompanyInput | null {
  const name = place.displayName?.text?.trim();

  if (!name) return null;

  const component = (type: string, short = false) => {
    const c = place.addressComponents?.find((x) =>
      x.types?.includes(type),
    );
    return short ? c?.shortText : c?.longText;
  };

  const parsed = parseCityState(place.formattedAddress);

  return {
    name,
    segment,
    city:
      component("administrative_area_level_2") ||
      component("locality") ||
      parsed.city,
    state:
      component("administrative_area_level_1", true) ||
      parsed.state,
    website: place.websiteUri,
    phone: place.nationalPhoneNumber,
    googlePlaceId: place.id,
    address: place.formattedAddress,
    category: place.primaryTypeDisplayName?.text,
    rating: place.rating,
    reviewsCount: place.userRatingCount,
  };
}

/** Traduz a resposta de erro do Google em orientação acionável. */
export async function describeGoogleError(
  response: Response,
): Promise<string> {
  let detail = "";

  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string };
    };

    detail = body.error?.message ?? body.error?.status ?? "";
  } catch {
    // corpo não-JSON
  }

  const hint: Record<number, string> = {
    400: "Requisição inválida (confira a chave).",
    401: "Chave inválida ou ausente.",
    403: 'Acesso negado: ative a "Places API (New)" no projeto, ative o faturamento e confira as restrições da chave.',
    429: "Limite de uso/cota excedido.",
  };

  return `Google Places (${response.status}): ${hint[response.status] ?? "erro inesperado."}${detail ? ` Detalhe: ${detail}` : ""}`;
}

/** Faz uma busca mínima só para validar chave, API e faturamento. */
export async function testGooglePlacesConnection(): Promise<string> {
  const places = await searchPlaces("restaurante", "São Paulo", 1, 1);

  return `Conexão OK: a API respondeu (${places.length} resultado de teste).`;
}


/* ---------- Places API legada (fallback) ---------- */

interface LegacyResult {
  place_id: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
}

interface LegacyResponse {
  status: string;
  error_message?: string;
  results?: LegacyResult[];
  next_page_token?: string;
  result?: { website?: string; formatted_phone_number?: string };
}

/** "Rua X, 10 - Bairro, Cuiabá - MT, 78000-000, Brasil" -> cidade e UF. */
export function parseCityState(
  address: string | undefined,
): { city?: string; state?: string } {
  const match = address?.match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\b/);

  return match
    ? { city: match[1].trim(), state: match[2] }
    : {};
}

export function legacyToPlace(
  r: LegacyResult,
  details?: LegacyResponse["result"],
): GooglePlace {
  return {
    id: r.place_id,
    displayName: { text: r.name },
    formattedAddress: r.formatted_address,
    rating: r.rating,
    userRatingCount: r.user_ratings_total,
    primaryTypeDisplayName: r.types?.[0]
      ? { text: r.types[0] }
      : undefined,
    websiteUri: details?.website,
    nationalPhoneNumber: details?.formatted_phone_number,
  };
}

async function legacyGet(
  path: string,
  params: Record<string, string>,
): Promise<LegacyResponse> {
  const response = await httpFetch(
    `https://maps.googleapis.com/maps/api/place/${path}/json?${new URLSearchParams(params)}`,
  );

  await recordApiUsage({
    provider: "GOOGLE_PLACES",
    operation: `legacy.${path}`,
  });

  if (!response.ok) {
    throw new Error(
      `Google Places legada (${response.status}).`,
    );
  }

  const data = (await response.json()) as LegacyResponse;

  if (
    data.status !== "OK" &&
    data.status !== "ZERO_RESULTS"
  ) {
    throw new Error(
      `Google Places legada: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`,
    );
  }

  return data;
}

export async function searchPlacesLegacy(
  apiKey: string,
  segment: string,
  city: string,
  maxPages: number,
  withDetails = true,
): Promise<GooglePlace[]> {
  const places: GooglePlace[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    if (pageToken) {
      // O token só fica válido depois de ~2s.
      await new Promise((r) => setTimeout(r, 2200));
    }

    const data = await legacyGet(
      "textsearch",
      pageToken
        ? { pagetoken: pageToken, key: apiKey }
        : {
            query: `${segment} em ${city}`,
            language: "pt-BR",
            key: apiKey,
          },
    );

    for (const r of data.results ?? []) {
      let details: LegacyResponse["result"];

      if (withDetails) {
        try {
          details = (
            await legacyGet("details", {
              place_id: r.place_id,
              fields: "website,formatted_phone_number",
              language: "pt-BR",
              key: apiKey,
            })
          ).result;
        } catch {
          // Sem contato para este resultado; segue com os demais.
        }
      }

      places.push(legacyToPlace(r, details));
    }

    pageToken = data.next_page_token;

    if (!pageToken) break;
  }

  return places;
}

async function searchPlacesNew(
  apiKey: string,
  segment: string,
  city: string,
  maxPages = 1,
  pageSize = 20,
): Promise<GooglePlace[]> {
  const places: GooglePlace[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const response = await httpFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          FIELD_MASK + ",nextPageToken",
      },
      body: JSON.stringify({
        textQuery: `${segment} em ${city}`,
        languageCode: "pt-BR",
        pageSize,
        ...(pageToken ? { pageToken } : {}),
      }),
    });

    await recordApiUsage({
      provider: "GOOGLE_PLACES",
      operation: "searchText",
    });

    if (!response.ok) {
      throw new Error(await describeGoogleError(response));
    }

    const data = (await response.json()) as {
      places?: GooglePlace[];
      nextPageToken?: string;
    };

    places.push(...(data.places ?? []));

    pageToken = data.nextPageToken;

    if (!pageToken) break;
  }

  return places;
}

/**
 * Tenta a Places API (New); se o Google a recusar (403: API não
 * ativada ou bloqueada na chave), usa a Places API legada.
 */
export async function searchPlaces(
  segment: string,
  city: string,
  maxPages = 1,
  pageSize = 20,
): Promise<GooglePlace[]> {
  const apiKey = await getSetting("google_api_key");

  if (!apiKey) {
    throw new Error(
      "Configure a chave da Google Places API em Settings.",
    );
  }

  try {
    return await searchPlacesNew(
      apiKey,
      segment,
      city,
      maxPages,
      pageSize,
    );
  } catch (err) {
    const text = err instanceof Error ? err.message : "";

    if (!text.includes("(403)")) throw err;

    return searchPlacesLegacy(
      apiKey,
      segment,
      city,
      maxPages,
      pageSize > 1,
    );
  }
}
