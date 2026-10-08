import { importCompany } from "../companies/company.service";
import { startJob } from "../jobs/job.service";

import {
  findKnownPlaceIds,
  markPlaceSeen,
  recordSearch,
} from "./discovery.repository";

import {
  completePlace,
  placeToCompanyInput,
  searchPlaces,
} from "./googlePlaces.client";

import type { GooglePlace } from "./googlePlaces.client";

export interface DiscoveryResult {
  found: number;
  imported: number;
  /** Já existia como empresa (mesmo site/telefone/nome+endereço...). */
  duplicates: number;
  /** Lugar do Google coletado antes: ignorado, sem custo extra. */
  alreadySeen: number;
  /** Ids das empresas NOVAS (para oferecer o enriquecimento). */
  companyIds: number[];
}

/**
 * Importa resultados como Company (nunca como Prospect). Lugares do
 * Google já coletados antes são ignorados — mesmo que a empresa tenha
 * sido apagada ou mesclada depois.
 */
export async function importPlaces(
  places: GooglePlace[],
  segment: string,
  report?: (percent: number) => Promise<void>,
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    found: places.length,
    imported: 0,
    duplicates: 0,
    alreadySeen: 0,
    companyIds: [],
  };

  const known = await findKnownPlaceIds(places.map((p) => p.id));

  for (const [index, place] of places.entries()) {
    if (known.has(place.id)) {
      result.alreadySeen++;
      await markPlaceSeen(place.id, null);
    } else {
      known.add(place.id); // repetido dentro da própria busca

      // API legada: telefone/site só para lugares realmente novos.
      const full = await completePlace(place);
      const input = placeToCompanyInput(full, segment);

      if (input) {
        const imported = await importCompany(input, "GOOGLE_PLACES", full);

        await markPlaceSeen(place.id, imported.id);

        if (imported.created) {
          result.imported++;
          result.companyIds.push(imported.id);
        } else {
          result.duplicates++;
        }
      }
    }

    await report?.(((index + 1) / Math.max(places.length, 1)) * 100);
  }

  return result;
}

export interface DiscoveryOptions {
  neighborhood?: string;
  /** 1 a 3 páginas de resultados (20 por página). */
  pages?: number;
}

export function startDiscovery(
  segment: string,
  city: string,
  options: DiscoveryOptions = {},
): Promise<number> {
  const seg = segment.trim();
  const cty = city.trim();
  const area = options.neighborhood?.trim() || undefined;
  const pages = Math.min(Math.max(options.pages ?? 1, 1), 3);

  if (!seg || !cty) {
    throw new Error("Informe segmento e cidade.");
  }

  const query = area ? `${seg} em ${area}, ${cty}` : `${seg} em ${cty}`;

  return startJob("DISCOVERY", async (report) => {
    const places = await searchPlaces(query, pages);
    const result = await importPlaces(places, seg, report);

    await recordSearch({
      segment: seg,
      city: cty,
      neighborhood: area,
      pages,
      found: result.found,
      imported: result.imported,
    });

    return result;
  });
}
