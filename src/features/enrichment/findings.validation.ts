import {
  normalizeEmail,
  normalizeDomain,
  normalizePhone,
  siteDomain,
  socialProfile,
  stripAccents,
} from "../../lib/normalize";

export const FINDING_FIELDS = [
  "WEBSITE",
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
] as const;

export type FindingField = (typeof FINDING_FIELDS)[number];

export interface Finding {
  field: FindingField;
  /** Valor normalizado (domínio/URL do site, telefone só com dígitos, e-mail, @perfil). */
  value: string;
  /** Endereço para abrir/guardar (URL do site ou do perfil). */
  url: string;
  sourceUrl: string;
  evidence: string;
}

/** URL sem parâmetros, ancora, "www" e barra final: para comparar citações. */
export function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);

    if (!/^https?:$/.test(url.protocol)) return null;

    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const MAX_PER_FIELD: Partial<Record<FindingField, number>> = {
  WHATSAPP: 2,
  PHONE: 2,
  EMAIL: 2,
};

/** Normaliza o valor segundo o campo; null se não for um dado válido. */
export function normalizeFinding(
  field: FindingField,
  raw: string,
): { value: string; url: string } | null {
  const text = raw.trim();

  switch (field) {
    case "WEBSITE": {
      const domain = siteDomain(text);

      return domain ? { value: domain, url: `https://${domain}` } : null;
    }
    case "PHONE":
    case "WHATSAPP": {
      const phone = normalizePhone(text.replace(/^https?:\/\/wa\.me\//i, ""));

      return phone
        ? {
            value: phone,
            url: field === "WHATSAPP" ? `https://wa.me/55${phone}` : `tel:+55${phone}`,
          }
        : null;
    }
    case "EMAIL": {
      const email = normalizeEmail(text);

      return email ? { value: email, url: `mailto:${email}` } : null;
    }
    default: {
      const profile = socialProfile(text.startsWith("@") ? `instagram.com/${text.slice(1)}` : text);

      return profile && profile.kind === field
        ? { value: profile.handle, url: profile.url }
        : null;
    }
  }
}

/**
 * Valida a resposta da IA. Só passa um achado que:
 *  - é de um campo que FALTA na empresa (nunca repete o que já existe);
 *  - tem valor válido e normalizável;
 *  - cita uma página que a própria busca na web retornou (anotação de citação);
 *  - traz um trecho de evidência.
 * O resto é descartado e contado.
 */
export function validateFindings(
  raw: unknown,
  ctx: { missing: FindingField[]; citedUrls: string[] },
): { findings: Finding[]; dropped: number } {
  const list = Array.isArray((raw as { findings?: unknown })?.findings)
    ? ((raw as { findings: unknown[] }).findings)
    : [];

  const cited = new Set(ctx.citedUrls.map(canonicalUrl).filter(Boolean) as string[]);
  const out: Finding[] = [];
  const seen = new Set<string>();
  const perField = new Map<FindingField, number>();
  let dropped = 0;

  for (const item of list) {
    const f = item as Record<string, unknown>;
    const field = String(f?.field ?? "").toUpperCase() as FindingField;
    const sourceUrl = String(f?.source_url ?? "").trim();
    const evidence = String(f?.evidence ?? "").trim();
    const canonical = canonicalUrl(sourceUrl);

    const normalized =
      FINDING_FIELDS.includes(field) && typeof f?.value === "string"
        ? normalizeFinding(field, f.value)
        : null;

    const limit = MAX_PER_FIELD[field] ?? 1;

    if (
      !normalized ||
      !ctx.missing.includes(field) ||
      !canonical ||
      !cited.has(canonical) ||
      !evidence ||
      seen.has(`${field}:${normalized.value}`) ||
      (perField.get(field) ?? 0) >= limit
    ) {
      dropped++;
      continue;
    }

    seen.add(`${field}:${normalized.value}`);
    perField.set(field, (perField.get(field) ?? 0) + 1);

    out.push({
      field,
      value: normalized.value,
      url: normalized.url,
      sourceUrl,
      evidence: evidence.slice(0, 240),
    });
  }

  return { findings: out, dropped };
}

/** Palavras do nome com 4+ letras, sem acento. */
const nameTokens = (name: string) =>
  stripAccents(name.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !["clinica", "centro", "empresa", "ltda", "servicos"].includes(t));

/**
 * Confere se a página citada realmente mostra o dado (e, para o site,
 * se é da empresa). `html` e `text` vêm da página aberta pelo app.
 */
export function verifyAgainstPage(
  finding: Finding,
  page: { html: string; text: string },
  companyName: string,
): boolean {
  const html = stripAccents(page.html.toLowerCase());
  const text = stripAccents(page.text.toLowerCase());
  const digits = page.text.replace(/\D/g, "");

  switch (finding.field) {
    case "PHONE":
    case "WHATSAPP":
      return (
        (finding.value.length >= 8 && digits.includes(finding.value.slice(-8))) ||
        html.includes(finding.value)
      );
    case "EMAIL":
      return html.includes(finding.value);
    case "WEBSITE": {
      const tokens = nameTokens(companyName);
      const mentionsName = tokens.length === 0 || tokens.filter((t) => text.includes(t)).length >= Math.ceil(tokens.length / 2);
      const sourceHost = normalizeDomain(finding.sourceUrl);

      // A página É o site: precisa falar da empresa. Se for um diretório: precisa citar o domínio.
      return sourceHost === finding.value ? mentionsName : html.includes(finding.value) && mentionsName;
    }
    default: {
      const handle = finding.value.split("/").pop()!.replace(/^@/, "");

      return handle.length >= 3 && html.includes(handle);
    }
  }
}
