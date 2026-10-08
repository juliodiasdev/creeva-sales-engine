import { fetchAllPages, getSupabase, unwrap } from "../../lib/store";

import {
  normalizeEmail,
  socialProfile,
} from "../../lib/normalize";

import { getSetting, setSetting } from "../settings/settings.service";

const GENERIC_DOMAINS = [
  "instagram.com", "facebook.com", "fb.com", "fb.me", "linkedin.com",
  "youtube.com", "youtu.be", "tiktok.com", "twitter.com", "x.com", "wa.me",
  "whatsapp.com", "api.whatsapp.com", "web.whatsapp.com", "linktr.ee",
  "linkin.bio", "beacons.ai", "bio.link", "lnk.bio", "google.com", "goo.gl",
  "g.page", "bit.ly",
];

const SOCIAL_KINDS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "TIKTOK"];

export interface RepairReport {
  domainsCleared: number;
  ledgerReleased: number;
  junkChannelsRemoved: number;
}

/**
 * Corrige dados gerados por versões anteriores:
 *  - domínio "instagram.com"/"facebook.com" gravado como se fosse site
 *    (fazia empresas diferentes parecerem duplicadas);
 *  - lugares do Google marcados como "já coletados" só por causa disso;
 *  - canais lixo (instagram.com/blog, facebook.com/docs, e-mails do Wix…).
 * É idempotente e roda uma única vez por banco.
 */
export async function repairLegacyData(): Promise<RepairReport> {
  const supabase = getSupabase();
  const report: RepairReport = {
    domainsCleared: 0,
    ledgerReleased: 0,
    junkChannelsRemoved: 0,
  };

  // 1) domínios genéricos + registro de lugares indevidamente bloqueados
  const affected = unwrap(
    await supabase
      .from("companies")
      .select("id,google_place_id,domain")
      .in("domain", GENERIC_DOMAINS),
  ) as { id: number; google_place_id: string | null; domain: string }[];

  for (const company of affected) {
    const wrongly = unwrap(
      await supabase
        .from("seen_places")
        .select("google_place_id")
        .eq("company_id", company.id),
    ) as { google_place_id: string }[];

    for (const row of wrongly) {
      if (row.google_place_id !== company.google_place_id) {
        unwrap(
          await supabase
            .from("seen_places")
            .delete()
            .eq("google_place_id", row.google_place_id),
        );
        report.ledgerReleased++;
      }
    }

    unwrap(
      await supabase
        .from("companies")
        .update({ domain: null })
        .eq("id", company.id),
    );
    report.domainsCleared++;
  }

  // 2) canais lixo
  const channels = await fetchAllPages<{
    id: number;
    kind: string;
    value: string;
    url: string | null;
  }>((from, to) =>
    supabase
      .from("company_channels")
      .select("id,kind,value,url")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  const junk = channels.filter((c) => {
    if (c.kind === "EMAIL") return normalizeEmail(c.value) === null;

    if (SOCIAL_KINDS.includes(c.kind)) {
      const profile = socialProfile(c.url ?? c.value);

      return !profile || profile.handle !== c.value;
    }

    if (c.kind === "WEBSITE") {
      return GENERIC_DOMAINS.includes(c.value);
    }

    return false;
  });

  for (let i = 0; i < junk.length; i += 100) {
    unwrap(
      await supabase
        .from("company_channels")
        .delete()
        .in("id", junk.slice(i, i + 100).map((c) => c.id)),
    );
  }

  report.junkChannelsRemoved = junk.length;

  return report;
}

/** Executa os reparos uma única vez (marcador em settings). */
export async function runRepairsOnce(): Promise<RepairReport | null> {
  if ((await getSetting("data_repairs")) === "v1") return null;

  const report = await repairLegacyData();

  await setSetting("data_repairs", "v1");

  return report;
}
