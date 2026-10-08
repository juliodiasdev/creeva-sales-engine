import {
  fetchAllPages,
  getSupabase,
} from "../../lib/store";

import type { Company } from "../companies/company.types";
import type { StoredChannel } from "../contacts/channels.repository";
import type { ChannelKind } from "../contacts/channels.engine";
import type { StoredApproach } from "../contacts/approaches.repository";

export interface ContactRow {
  empresa: string;
  segmento: string;
  cidade: string;
  uf: string;
  endereco: string;
  telefone: string;
  whatsapp: string;
  email: string;
  site: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
  tiktok: string;
  nota_google: number | null;
  avaliacoes: number | null;
  score: number | null;
  status_lead: string;
  status_prospect: string;
  servico_sugerido: string;
  abordagem_whatsapp: string;
  fonte: string;
  cadastrado_em: string;
}

export const CONTACT_COLUMNS: { key: keyof ContactRow; title: string; width: number }[] = [
  { key: "empresa", title: "Empresa", width: 32 },
  { key: "segmento", title: "Segmento", width: 18 },
  { key: "cidade", title: "Cidade", width: 16 },
  { key: "uf", title: "UF", width: 5 },
  { key: "endereco", title: "Endereço", width: 36 },
  { key: "telefone", title: "Telefone", width: 16 },
  { key: "whatsapp", title: "WhatsApp", width: 16 },
  { key: "email", title: "E-mail", width: 28 },
  { key: "site", title: "Site", width: 28 },
  { key: "instagram", title: "Instagram", width: 28 },
  { key: "facebook", title: "Facebook", width: 28 },
  { key: "linkedin", title: "LinkedIn", width: 28 },
  { key: "youtube", title: "YouTube", width: 24 },
  { key: "tiktok", title: "TikTok", width: 24 },
  { key: "nota_google", title: "Nota Google", width: 12 },
  { key: "avaliacoes", title: "Avaliações", width: 12 },
  { key: "score", title: "Score", width: 8 },
  { key: "status_lead", title: "Status do lead", width: 16 },
  { key: "status_prospect", title: "Status do prospect", width: 18 },
  { key: "servico_sugerido", title: "Serviço sugerido", width: 26 },
  { key: "abordagem_whatsapp", title: "Abordagem (WhatsApp)", width: 60 },
  { key: "fonte", title: "Fonte", width: 14 },
  { key: "cadastrado_em", title: "Cadastrado em", width: 16 },
];

const phoneBr = (digits: string) =>
  digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : digits.length === 10
      ? `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
      : digits;

const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_PLACES: "Google Places",
  MANUAL: "Manual",
  CNPJ: "CNPJ",
  WEBSITE: "Site",
};

/** Monta as linhas da planilha: uma por empresa, sem duplicar. */
export function buildContactRows(input: {
  companies: Company[];
  channels: StoredChannel[];
  approaches: StoredApproach[];
  scores: Map<number, number>;
  prospectStatus: Map<number, string>;
  sources: Map<number, string>;
  serviceNames: Map<string, string>;
}): ContactRow[] {
  const byCompany = new Map<number, StoredChannel[]>();

  for (const ch of input.channels) {
    const id = Number(ch.company_id);
    byCompany.set(id, [...(byCompany.get(id) ?? []), ch]);
  }

  const approachBy = new Map<number, StoredApproach[]>();

  for (const ap of input.approaches) {
    const id = Number(ap.company_id);
    approachBy.set(id, [...(approachBy.get(id) ?? []), ap]);
  }

  const seen = new Set<number>();

  return input.companies
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .map((c) => {
      const channels = byCompany.get(c.id) ?? [];

      const first = (kind: ChannelKind, fmt?: (v: string) => string) => {
        const ch = channels.find((x) => x.kind === kind);

        return ch ? (fmt ? fmt(ch.value) : ch.url ?? ch.value) : "";
      };

      const approaches = approachBy.get(c.id) ?? [];
      const wa =
        approaches.find((a) => a.channel === "WHATSAPP" && a.source === "AI") ??
        approaches.find((a) => a.channel === "WHATSAPP");

      const service = wa?.service_key
        ? input.serviceNames.get(wa.service_key) ?? wa.service_key
        : "";

      return {
        empresa: c.name,
        segmento: c.segment ?? "",
        cidade: c.city ?? "",
        uf: c.state ?? "",
        endereco: c.address ?? "",
        telefone: first("PHONE", phoneBr),
        whatsapp: first("WHATSAPP", (v) => `${phoneBr(v)}`),
        email: first("EMAIL", (v) => v),
        site: first("WEBSITE"),
        instagram: first("INSTAGRAM"),
        facebook: first("FACEBOOK"),
        linkedin: first("LINKEDIN"),
        youtube: first("YOUTUBE"),
        tiktok: first("TIKTOK"),
        nota_google: c.rating ?? null,
        avaliacoes: c.reviews_count ?? null,
        score: input.scores.get(c.id) ?? null,
        status_lead: c.lead_status,
        status_prospect: input.prospectStatus.get(c.id) ?? "",
        servico_sugerido: service,
        abordagem_whatsapp: wa?.message ?? "",
        fonte: SOURCE_LABEL[input.sources.get(c.id) ?? ""] ?? input.sources.get(c.id) ?? "",
        cadastrado_em: c.created_at?.slice(0, 10) ?? "",
      };
    });
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);

  // Evita "injeção de fórmula" ao abrir no Excel.
  const safe = /^[=+\-@]/.test(text) && !/^[+\-]?\d/.test(text) ? `'${text}` : text;

  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV com BOM e ';' (abre direto no Excel em português). */
export function toCsv(rows: ContactRow[]): string {
  const header = CONTACT_COLUMNS.map((c) => csvCell(c.title)).join(";");
  const lines = rows.map((row) =>
    CONTACT_COLUMNS.map((c) => csvCell(row[c.key])).join(";"),
  );

  return "﻿" + [header, ...lines].join("\r\n");
}

/** Carrega tudo do banco e monta as linhas. */
export async function loadContactRows(): Promise<ContactRow[]> {
  const supabase = getSupabase();
  const page = <T,>(table: string, columns: string, order = "id") =>
    fetchAllPages<T>((from, to) =>
      supabase
        .from(table)
        .select(columns)
        .order(order, { ascending: true })
        .range(from, to) as never,
    );

  const [companies, channels, approaches, scores, prospects, sources, services] =
    await Promise.all([
      page<Company>("companies", "*"),
      page<StoredChannel>("company_channels", "*"),
      page<StoredApproach>("company_approaches", "*"),
      page<{ company_id: number; total: number; id: number }>("company_scores", "id,company_id,total"),
      page<{ company_id: number; status: string }>("prospects", "id,company_id,status"),
      page<{ company_id: number; source_type: string }>("company_sources", "id,company_id,source_type"),
      page<{ key: string; name: string }>("services", "key,name", "key"),
    ]);

  const latestScore = new Map<number, number>();

  for (const s of scores) latestScore.set(Number(s.company_id), Number(s.total)); // ordenado por id: o último vence

  const firstSource = new Map<number, string>();

  for (const s of sources) {
    if (!firstSource.has(Number(s.company_id))) {
      firstSource.set(Number(s.company_id), s.source_type);
    }
  }

  return buildContactRows({
    companies: companies.map((c) => ({ ...c, id: Number(c.id) })),
    channels,
    approaches,
    scores: latestScore,
    prospectStatus: new Map(prospects.map((p) => [Number(p.company_id), p.status])),
    sources: firstSource,
    serviceNames: new Map(services.map((s) => [s.key, s.name])),
  });
}
