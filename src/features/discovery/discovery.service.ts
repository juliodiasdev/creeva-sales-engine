import { importCompany } from "../companies/company.service";
import { setLeadStatusRepository } from "../companies/company.repository";
import { startJob } from "../jobs/job.service";

import {
  createListRepository,
  deleteListRepository,
  updateListRepository,
} from "../lists/lists.repository";

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
  /** Lista criada para esta busca (null se não houve empresa nova). */
  listId: number | null;
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
  listId?: number,
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    found: places.length,
    imported: 0,
    duplicates: 0,
    alreadySeen: 0,
    companyIds: [],
    listId: listId ?? null,
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
        const imported = await importCompany(
          { ...input, listId },
          "GOOGLE_PLACES",
          full,
        );

        await markPlaceSeen(place.id, imported.id);

        if (imported.created) {
          result.imported++;
          result.companyIds.push(imported.id);

          // O Google informa que o negócio fechou: já entra descartado.
          if (full.businessStatus === "CLOSED_PERMANENTLY") {
            await setLeadStatusRepository(
              imported.id,
              "DISQUALIFIED",
              "Fechada permanentemente (informação do Google Maps)",
            );
          }
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
  /** UF (ex.: "MT"): evita confundir cidades de mesmo nome. */
  state?: string;
  /** Nome da lista; se vazio, usa "Nicho — Cidade · data". */
  listName?: string;
  /** 1 a 3 páginas de resultados (20 por página). */
  pages?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Odontologia — Cuiabá · 09/10" */
export function buildListName(
  segment: string,
  city: string,
  neighborhood: string | undefined,
  when = new Date(),
): string {
  const cap = segment.charAt(0).toUpperCase() + segment.slice(1);
  const place = neighborhood ? `${neighborhood}, ${city}` : city;

  return `${cap} — ${place} · ${pad(when.getDate())}/${pad(when.getMonth() + 1)}`;
}

/**
 * Cada busca vira uma LISTA ("pasta") só com dados do Google Maps.
 * Se nenhuma empresa nova for encontrada, a lista não é mantida.
 */
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

  const uf = options.state?.trim().toUpperCase() || undefined;
  const where = uf ? `${cty} - ${uf}` : cty;
  const query = area ? `${seg} em ${area}, ${where}` : `${seg} em ${where}`;

  return startJob("DISCOVERY", async (report) => {
    const places = await searchPlaces(query, pages);

    const listId = await createListRepository({
      name: options.listName?.trim() || buildListName(seg, where, area),
      segment: seg,
      city: cty,
      neighborhood: area,
      queryText: query,
      pages,
    });

    let result: DiscoveryResult;

    try {
      result = await importPlaces(places, seg, report, listId);
    } catch (err) {
      await deleteListRepository(listId).catch(() => undefined);
      throw err;
    }

    if (result.imported === 0) {
      await deleteListRepository(listId);
      result.listId = null;
    } else {
      await updateListRepository(listId, {
        found: result.found,
        imported: result.imported,
        duplicates: result.duplicates,
        already_seen: result.alreadySeen,
      });
    }

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
