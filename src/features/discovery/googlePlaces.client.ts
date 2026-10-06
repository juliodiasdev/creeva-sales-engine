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

  return {
    name,
    segment,
    city:
      component("administrative_area_level_2") ||
      component("locality"),
    state: component("administrative_area_level_1", true),
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
