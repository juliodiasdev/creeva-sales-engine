import { parseJsonText } from "../../lib/jsonText";
import { openaiWebSearch } from "../ai/openai.search";
import type { WebSearch } from "../ai/openai.search";
import { getCompanyRepository, setCompanyWebsiteRepository } from "../companies/company.repository";
import { saveChannelsRepository, listChannelsRepository } from "../contacts/channels.repository";
import { socialProfile } from "../../lib/normalize";
import { assessAndSavePresence } from "../presence/presence.service";

import { fetchPageText } from "./website.crawler";
import { buildFichaRows, missingForSearch } from "./ficha.service";
import {
  decideFindingRepository,
  getFindingRepository,
  listFindingsRepository,
  reopenFindingRepository,
  saveFindingsRepository,
} from "./findings.repository";
import { validateFindings, verifyAgainstPage } from "./findings.validation";
import type { FindingField } from "./findings.validation";

export interface SearchDeps {
  search: WebSearch;
  fetchPage: (url: string) => Promise<{ html: string; text: string } | null>;
}

const DEFAULT_DEPS: SearchDeps = { search: openaiWebSearch, fetchPage: fetchPageText };

const FIELD_HELP: Record<FindingField, string> = {
  WEBSITE: "WEBSITE: o site OFICIAL próprio da empresa (nunca Instagram, Facebook, Google, diretórios ou marketplaces)",
  WHATSAPP: "WHATSAPP: número de WhatsApp divulgado pela empresa (com DDD)",
  PHONE: "PHONE: telefone de contato divulgado pela empresa (com DDD)",
  EMAIL: "EMAIL: e-mail de contato público da empresa",
  INSTAGRAM: "INSTAGRAM: perfil oficial da empresa (link do perfil)",
  FACEBOOK: "FACEBOOK: página oficial da empresa (link da página)",
  LINKEDIN: "LINKEDIN: página da empresa (link linkedin.com/company/…)",
  YOUTUBE: "YOUTUBE: canal oficial da empresa (link)",
  TIKTOK: "TIKTOK: perfil oficial da empresa (link)",
};

const SYSTEM = `Você é um pesquisador de dados comerciais de empresas brasileiras. Use a busca na web para achar dados PÚBLICOS e OFICIAIS de UMA empresa.
Regras obrigatórias:
- Só inclua um dado se uma página encontrada na busca o mostrar claramente E a página for da mesma empresa (o nome e a cidade, o telefone ou o endereço precisam bater).
- Nunca deduza, complete, adivinhe nem invente. Na dúvida, deixe de fora. Lista vazia é uma resposta válida.
- "source_url" deve ser uma página que a busca realmente retornou, onde o dado aparece. "evidence" é um trecho curto copiado dessa página.
- Responda SOMENTE com JSON: {"findings":[{"field":"WEBSITE|WHATSAPP|PHONE|EMAIL|INSTAGRAM|FACEBOOK|LINKEDIN|YOUTUBE|TIKTOK","value":"...","source_url":"https://...","evidence":"..."}]}`;

export interface SearchOutcome {
  status: "DONE" | "NOTHING_MISSING";
  found: number;
  /** Sugestões cuja página citada foi aberta e confirma o dado. */
  verified: number;
  dropped: number;
  searches: number;
}

/**
 * Busca com a IA (pesquisa na web) o que FALTA no cadastro da empresa.
 * O resultado só vira SUGESTÃO: nada é aplicado sem a decisão do usuário.
 */
export async function searchCompanyWithAi(
  companyId: number,
  deps: SearchDeps = DEFAULT_DEPS,
): Promise<SearchOutcome> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const [channels, existing] = await Promise.all([
    listChannelsRepository(companyId),
    listFindingsRepository(companyId),
  ]);

  const missing = missingForSearch(buildFichaRows(company, channels, existing));

  if (missing.length === 0) {
    return { status: "NOTHING_MISSING", found: 0, verified: 0, dropped: 0, searches: 0 };
  }

  const known = channels
    .filter((c) => ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "WEBSITE"].includes(c.kind))
    .map((c) => `${c.kind}: ${c.value}`);

  const user = `Empresa: ${company.name}
Cidade: ${company.city ?? "?"}${company.state ? ` - ${company.state}` : ""}
Endereço: ${company.address ?? "não informado"}
Telefone cadastrado: ${company.phone ?? "não informado"}
Categoria: ${company.category ?? company.segment ?? "não informada"}
Já conhecidos (não repetir): ${known.join("; ") || "nenhum"}

Procure SOMENTE estes dados que faltam:
${missing.map((f) => `- ${FIELD_HELP[f]}`).join("\n")}`;

  const result = await deps.search(SYSTEM, user);

  let parsed: unknown;

  try {
    parsed = parseJsonText(result.text);
  } catch {
    throw new Error("A IA respondeu em um formato inesperado. Tente de novo.");
  }

  const { findings, dropped } = validateFindings(parsed, {
    missing,
    citedUrls: result.citations,
  });

  // Confere cada achado abrindo a página citada (até 3 ao mesmo tempo).
  const checked: ((typeof findings)[number] & { verified: boolean })[] = [];

  for (let i = 0; i < findings.length; i += 3) {
    const batch = await Promise.all(
      findings.slice(i, i + 3).map(async (f) => {
        const page = await deps.fetchPage(f.sourceUrl).catch(() => null);

        return { ...f, verified: !!page && verifyAgainstPage(f, page, company.name) };
      }),
    );

    checked.push(...batch);
  }

  await saveFindingsRepository(companyId, checked, result.model);

  return {
    status: "DONE",
    found: checked.length,
    verified: checked.filter((f) => f.verified).length,
    dropped,
    searches: result.searches,
  };
}

/* ---------- decisão do usuário ---------- */

async function applyFinding(companyId: number, field: FindingField, value: string, sourceUrl: string) {
  const label = "encontrado pela busca com IA e aprovado por você";

  if (field === "WEBSITE") {
    const { previousGenericLink } = await setCompanyWebsiteRepository(companyId, `https://${value}`);

    // O link de rede social que estava no lugar do site não se perde: vira canal.
    const profile = previousGenericLink ? socialProfile(previousGenericLink) : null;

    if (profile) {
      await saveChannelsRepository(companyId, [
        { kind: profile.kind, value: profile.handle, url: profile.url, label: null, source: "GOOGLE_PLACES" },
      ]);
    }

    await saveChannelsRepository(companyId, [
      { kind: "WEBSITE", value, url: `https://${value}`, label, source: "AI_SEARCH" },
    ]);

    return;
  }

  const url =
    field === "WHATSAPP"
      ? `https://wa.me/55${value}`
      : field === "PHONE"
        ? `tel:+55${value}`
        : field === "EMAIL"
          ? `mailto:${value}`
          : (socialProfile(sourceUrl)?.kind === field ? socialProfile(sourceUrl)!.url : socialUrl(field, value));

  await saveChannelsRepository(companyId, [
    { kind: field, value, url, label, source: "AI_SEARCH" },
  ]);
}

function socialUrl(field: FindingField, handle: string): string {
  switch (field) {
    case "INSTAGRAM":
      return `https://www.instagram.com/${handle}/`;
    case "FACEBOOK":
      return `https://www.facebook.com/${handle}`;
    case "LINKEDIN":
      return `https://www.linkedin.com/${handle}`;
    case "YOUTUBE":
      return `https://www.youtube.com/${handle}`;
    default:
      return `https://www.tiktok.com/@${handle}`;
  }
}

/**
 * Você aceita ou rejeita uma sugestão. Aceitar aplica o dado à empresa com a
 * origem "Busca com IA (aprovado por você)". Sugestão não confirmada na
 * página exige confirmação explícita (force).
 */
export async function decideFinding(
  id: number,
  decision: "ACCEPTED" | "REJECTED",
  options: { force?: boolean } = {},
): Promise<void> {
  const finding = await getFindingRepository(id);

  if (!finding) throw new Error("Sugestão não encontrada.");

  if (decision === "ACCEPTED" && !finding.verified && !options.force) {
    throw new Error(
      "A página citada não confirmou este dado. Confirme que quer aceitar mesmo assim.",
    );
  }

  if (!(await decideFindingRepository(id, decision))) {
    throw new Error("Esta sugestão já foi decidida.");
  }

  if (decision === "REJECTED") return;

  try {
    await applyFinding(Number(finding.company_id), finding.field, finding.value, finding.source_url);

    // O dado novo muda a avaliação da presença: refaz sem nova leitura do site.
    await assessAndSavePresence(Number(finding.company_id)).catch(() => undefined);
  } catch (err) {
    await reopenFindingRepository(id);
    throw err;
  }
}

