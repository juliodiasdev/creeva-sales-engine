import { importCompany } from "../companies/company.service";
import { startJob } from "../jobs/job.service";

import {
  placeToCompanyInput,
  searchPlaces,
} from "./googlePlaces.client";

import type { GooglePlace } from "./googlePlaces.client";

export interface DiscoveryResult {
  found: number;
  imported: number;
  duplicates: number;
}

/** Importa resultados como Company (nunca como Prospect). */
export async function importPlaces(
  places: GooglePlace[],
  segment: string,
  report?: (percent: number) => Promise<void>,
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    found: places.length,
    imported: 0,
    duplicates: 0,
  };

  for (const [index, place] of places.entries()) {
    const input = placeToCompanyInput(place, segment);

    if (input) {
      const imported = await importCompany(
        input,
        "GOOGLE_PLACES",
        place,
      );

      if (imported.created) result.imported++;
      else result.duplicates++;
    }

    await report?.(((index + 1) / places.length) * 100);
  }

  return result;
}

export function startDiscovery(
  segment: string,
  city: string,
  maxPages = 1,
): Promise<number> {
  if (!segment.trim() || !city.trim()) {
    throw new Error("Informe segmento e cidade.");
  }

  return startJob("DISCOVERY", async (report) => {
    const places = await searchPlaces(
      segment.trim(),
      city.trim(),
      maxPages,
    );

    return importPlaces(places, segment.trim(), report);
  });
}
