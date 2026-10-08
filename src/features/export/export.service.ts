import { fetchAllPages, getSupabase } from "../../lib/store";

import {
  LEAD_STATUS_LABEL,
  SOURCE_LABEL,
  label,
} from "../../lib/labels";

import { formatPhone } from "../../lib/format";

import type { Company } from "../companies/company.types";
import type { StoredChannel } from "../contacts/channels.repository";
import type { ChannelKind } from "../contacts/channels.engine";
import type { StoredApproach } from "../contacts/approaches.repository";
import { STATUS_LABEL } from "../prospects/prospect.labels";

import { cleanBusinessName } from "./names";

export interface ExportCompany {
  id: number;
  name: string;
  originalName: string;
  segment: string;
  city: string;
  state: string;
  address: string;
  score: number | null;
  leadStatus: string;
  prospectStatus: string;
  whatsapp: string;
  whatsappUrl: string;
  whatsappProbable: boolean;
  landline: string;
  email: string;
  website: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  otherSocials: string;
  service: string;
  approach: string;
  rating: number | null;
  reviews: number | null;
  source: string;
  createdAt: string;
  hasContact: boolean;
  missing: string;
}

export interface ExportApproach {
  company: string;
  channel: string;
  service: string;
  origin: string;
  message: string;
}

export interface ExportData {
  companies: ExportCompany[];
  approaches: ExportApproach[];
}

const CHANNEL_NAME: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  EMAIL: "E-mail",
  PHONE: "Ligação",
  LINKEDIN: "LinkedIn",
};

const formatDate = (iso: string | null | undefined) => {
  const m = (iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);

  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** Organiza os dados para a planilha: uma linha por empresa, sem duplicar. */
export function buildExportData(input: {
  companies: Company[];
  channels: StoredChannel[];
  approaches: StoredApproach[];
  scores: Map<number, number>;
  prospectStatus: Map<number, string>;
  sources: Map<number, string>;
  serviceNames: Map<string, string>;
}): ExportData {
  const channelsBy = new Map<number, StoredChannel[]>();

  for (const ch of input.channels) {
    const id = Number(ch.company_id);
    channelsBy.set(id, [...(channelsBy.get(id) ?? []), ch]);
  }

  const approachesBy = new Map<number, StoredApproach[]>();

  for (const ap of input.approaches) {
    const id = Number(ap.company_id);
    approachesBy.set(id, [...(approachesBy.get(id) ?? []), ap]);
  }

  const serviceName = (key: string | null) =>
    key ? (input.serviceNames.get(key) ?? key) : "";

  const seen = new Set<number>();
  const approaches: ExportApproach[] = [];

  const companies = input.companies
    .filter((c) => !seen.has(Number(c.id)) && seen.add(Number(c.id)))
    .map((c): ExportCompany => {
      const id = Number(c.id);
      const channels = channelsBy.get(id) ?? [];
      const of = (kind: ChannelKind) => channels.filter((x) => x.kind === kind);

      // WhatsApp: confirmado > link de conversa > provável (celular)
      const wa =
        of("WHATSAPP").find((x) => x.label === "confirmado no site") ??
        of("WHATSAPP").find((x) => x.value.startsWith("msg/")) ??
        of("WHATSAPP")[0];

      const waDigits = wa && !wa.value.startsWith("msg/") ? wa.value : null;

      // Telefone fixo: evita repetir o número que já está no WhatsApp.
      const landline = of("PHONE").find((p) => p.value !== waDigits);

      const approachList = approachesBy.get(id) ?? [];
      const best =
        approachList.find((a) => a.channel === "WHATSAPP" && a.source === "AI") ??
        approachList.find((a) => a.channel === "WHATSAPP") ??
        approachList[0];

      const url = (kind: ChannelKind) => of(kind)[0]?.url ?? "";

      const others = [...of("YOUTUBE"), ...of("TIKTOK")]
        .map((x) => x.url)
        .filter(Boolean)
        .join("  ");

      const hasContact =
        !!wa ||
        !!landline ||
        of("EMAIL").length > 0 ||
        of("INSTAGRAM").length + of("FACEBOOK").length + of("LINKEDIN").length > 0;

      const missing = hasContact
        ? ""
        : channels.length === 0 && c.lead_status === "DISCOVERED"
          ? "Ainda não enriquecida: rode “Enriquecer” para buscar contatos"
          : "Nenhum contato público encontrado";

      for (const ap of approachList) {
        approaches.push({
          company: cleanBusinessName(c.name),
          channel: CHANNEL_NAME[ap.channel] ?? ap.channel,
          service: serviceName(ap.service_key),
          origin: ap.source === "AI" ? "IA" : "Modelo",
          message: ap.message,
        });
      }

      return {
        id,
        name: cleanBusinessName(c.name),
        originalName: c.name,
        segment: c.segment ? c.segment.charAt(0).toUpperCase() + c.segment.slice(1) : "",
        city: c.city ?? "",
        state: c.state ?? "",
        address: (c.address ?? "").replace(/,\s*Brasil$/, ""),
        score: input.scores.get(id) ?? null,
        leadStatus: label(LEAD_STATUS_LABEL, c.lead_status),
        prospectStatus: input.prospectStatus.get(id)
          ? (STATUS_LABEL[input.prospectStatus.get(id) as keyof typeof STATUS_LABEL] ?? "")
          : "",
        whatsapp: wa
          ? waDigits
            ? formatPhone(waDigits)
            : "Link de conversa"
          : "",
        whatsappUrl: wa
          ? waDigits
            ? `https://wa.me/55${waDigits}`
            : (wa.url ?? "")
          : "",
        whatsappProbable: !!wa && (wa.label ?? "").startsWith("provável"),
        landline: landline ? formatPhone(landline.value) : "",
        email: of("EMAIL")[0]?.value ?? "",
        website: url("WEBSITE"),
        instagram: url("INSTAGRAM"),
        facebook: url("FACEBOOK"),
        linkedin: url("LINKEDIN"),
        otherSocials: others,
        service: serviceName(best?.service_key ?? null),
        approach: best?.message ?? "",
        rating: c.rating ?? null,
        reviews: c.reviews_count ?? null,
        source: label(SOURCE_LABEL, input.sources.get(id)),
        createdAt: formatDate(c.created_at),
        hasContact,
        missing,
      };
    });

  return { companies, approaches };
}

/* ---------- CSV (plano, para outros sistemas) ---------- */

export const CSV_COLUMNS: [keyof ExportCompany, string][] = [
  ["name", "Empresa"],
  ["segment", "Segmento"],
  ["city", "Cidade"],
  ["state", "UF"],
  ["address", "Endereço"],
  ["whatsapp", "WhatsApp"],
  ["landline", "Telefone"],
  ["email", "E-mail"],
  ["website", "Site"],
  ["instagram", "Instagram"],
  ["facebook", "Facebook"],
  ["linkedin", "LinkedIn"],
  ["score", "Pontuação"],
  ["leadStatus", "Situação"],
  ["prospectStatus", "Etapa de vendas"],
  ["service", "Serviço sugerido"],
  ["approach", "Abordagem (WhatsApp)"],
  ["rating", "Nota Google"],
  ["reviews", "Avaliações"],
  ["source", "Fonte"],
  ["createdAt", "Cadastrado em"],
];

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);

  // Evita "injeção de fórmula" ao abrir no Excel.
  const safe = /^[=+\-@]/.test(text) && !/^[+\-]?\d/.test(text) ? `'${text}` : text;

  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV com BOM e ';' (abre direto no Excel em português). */
export function toCsv(companies: ExportCompany[]): string {
  const header = CSV_COLUMNS.map(([, title]) => csvCell(title)).join(";");
  const lines = companies.map((c) =>
    CSV_COLUMNS.map(([key]) => csvCell(c[key])).join(";"),
  );

  return "﻿" + [header, ...lines].join("\r\n");
}

/** Carrega tudo do banco e organiza para exportação. */
export async function loadExportData(): Promise<ExportData> {
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
      page<{ company_id: number; total: number }>("company_scores", "id,company_id,total"),
      page<{ company_id: number; status: string }>("prospects", "id,company_id,status"),
      page<{ company_id: number; source_type: string }>("company_sources", "id,company_id,source_type"),
      page<{ key: string; name: string }>("services", "key,name", "key"),
    ]);

  const latestScore = new Map<number, number>();

  // ordenado por id: o último (mais recente) vence
  for (const s of scores) latestScore.set(Number(s.company_id), Number(s.total));

  const firstSource = new Map<number, string>();

  for (const s of sources) {
    if (!firstSource.has(Number(s.company_id))) {
      firstSource.set(Number(s.company_id), s.source_type);
    }
  }

  return buildExportData({
    companies: companies.map((c) => ({ ...c, id: Number(c.id) })),
    channels,
    approaches,
    scores: latestScore,
    prospectStatus: new Map(prospects.map((p) => [Number(p.company_id), p.status])),
    sources: firstSource,
    serviceNames: new Map(services.map((s) => [s.key, s.name])),
  });
}
