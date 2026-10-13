import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { importCompany } from "../companies/company.service";
import { getCompanyRepository } from "../companies/company.repository";
import { listChannelsRepository, saveChannelsRepository } from "../contacts/channels.repository";
import { createListRepository } from "../lists/lists.repository";
import { parseResponses } from "../ai/openai.search";
import { searchCompanyWithAi, decideFinding } from "./aisearch.service";
import { buildFichaRows, loadFicha, loadListFicha, missingForSearch } from "./ficha.service";
import { listFindingsRepository } from "./findings.repository";
import { canonicalUrl, validateFindings, verifyAgainstPage } from "./findings.validation";
import { getSupabase } from "../../lib/supabase";

const CITED = ["https://www.clinicasorriso.com.br/contato?utm=x", "https://guiamais.example/clinica-sorriso"];

const ctx = {
  missing: ["WEBSITE", "WHATSAPP", "EMAIL", "INSTAGRAM"] as never,
  citedUrls: CITED,
};

const f = (field: string, value: string, source_url = CITED[0], evidence = "trecho") => ({
  field, value, source_url, evidence,
});

describe("parseResponses (Responses API)", () => {
  it("junta o texto, as páginas citadas e conta as buscas", () => {
    const parsed = parseResponses({
      output: [
        { type: "web_search_call" },
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            { type: "output_text", text: '{"findings":[]}', annotations: [{ type: "url_citation", url: "https://a.com/x" }, { type: "url_citation", url: "https://a.com/x" }] },
          ],
        },
      ],
    });

    expect(parsed).toEqual({ text: '{"findings":[]}', citations: ["https://a.com/x"], searches: 2 });
  });
});

describe("canonicalUrl", () => {
  it("ignora www, parâmetros, âncora e barra final", () => {
    expect(canonicalUrl("https://www.A.com.br/contato/?utm=1#x")).toBe("a.com.br/contato");
    expect(canonicalUrl("ftp://a.com")).toBeNull();
    expect(canonicalUrl("lixo")).toBeNull();
  });
});

describe("validateFindings: só passa o que a busca realmente citou", () => {
  it("aceita achados válidos e normaliza os valores", () => {
    const { findings, dropped } = validateFindings(
      {
        findings: [
          f("website", "https://www.ClinicaSorriso.com.br/contato"),
          f("WHATSAPP", "(65) 99225-0342"),
          f("EMAIL", "Contato@ClinicaSorriso.com.br"),
          f("INSTAGRAM", "https://www.instagram.com/clinicasorriso/"),
        ],
      },
      ctx,
    );

    expect(dropped).toBe(0);
    expect(findings.map((x) => `${x.field}:${x.value}`)).toEqual([
      "WEBSITE:clinicasorriso.com.br",
      "WHATSAPP:65992250342",
      "EMAIL:contato@clinicasorriso.com.br",
      "INSTAGRAM:clinicasorriso",
    ]);
  });

  it("descarta fonte não citada, campo que não falta, valor inválido e sem evidência", () => {
    const { findings, dropped } = validateFindings(
      {
        findings: [
          f("WEBSITE", "https://clinicasorriso.com.br", "https://inventado.com/pagina"), // fonte não citada
          f("PHONE", "6533331111"), // PHONE não está em "missing"
          f("WEBSITE", "https://instagram.com/clinica"), // rede social não é site
          f("EMAIL", "no-reply@wix.com"), // e-mail de lixo
          f("INSTAGRAM", "https://facebook.com/clinica"), // rede errada
          f("WHATSAPP", "123"), // número inválido
          f("EMAIL", "ok@clinica.com.br", CITED[0], ""), // sem evidência
          { field: "ALGO", value: "x", source_url: CITED[0], evidence: "y" },
          "lixo",
          null,
        ],
      },
      ctx,
    );

    expect(findings).toEqual([]);
    expect(dropped).toBe(10);
  });

  it("não repete valores nem passa do limite por campo", () => {
    const { findings } = validateFindings(
      {
        findings: [
          f("WEBSITE", "https://a.com.br"),
          f("WEBSITE", "https://b.com.br"),
          f("WHATSAPP", "65992250342"),
          f("WHATSAPP", "(65) 99225-0342"),
          f("WHATSAPP", "65988887777"),
          f("WHATSAPP", "65977776666"),
        ],
      },
      ctx,
    );

    expect(findings.map((x) => x.value)).toEqual(["a.com.br", "65992250342", "65988887777"]);
  });

  it("resposta sem lista devolve vazio", () => {
    expect(validateFindings({ findings: "x" }, ctx)).toEqual({ findings: [], dropped: 0 });
    expect(validateFindings(null, ctx)).toEqual({ findings: [], dropped: 0 });
  });
});

describe("verifyAgainstPage: abre a página e confere", () => {
  const find = (field: string, value: string, sourceUrl = "https://x.com/p") =>
    ({ field, value, url: "", sourceUrl, evidence: "" }) as never;

  it("telefone, e-mail e perfil precisam aparecer na página", () => {
    const page = { html: '<a href="https://instagram.com/clinicasorriso">ig</a> contato@clinica.com.br', text: "Ligue (65) 99225-0342 · Clínica Sorriso" };

    expect(verifyAgainstPage(find("WHATSAPP", "65992250342"), page, "Clínica Sorriso")).toBe(true);
    expect(verifyAgainstPage(find("WHATSAPP", "65911112222"), page, "Clínica Sorriso")).toBe(false);
    expect(verifyAgainstPage(find("EMAIL", "contato@clinica.com.br"), page, "Clínica Sorriso")).toBe(true);
    expect(verifyAgainstPage(find("EMAIL", "outro@clinica.com.br"), page, "Clínica Sorriso")).toBe(false);
    expect(verifyAgainstPage(find("INSTAGRAM", "clinicasorriso"), page, "Clínica Sorriso")).toBe(true);
    expect(verifyAgainstPage(find("INSTAGRAM", "outraclinica"), page, "Clínica Sorriso")).toBe(false);
  });

  it("o site precisa ser da empresa (é a própria página) ou estar citado num diretório", () => {
    const own = { html: "<title>Clínica Sorriso Odontologia</title>", text: "Clínica Sorriso Odontologia Cuiabá" };
    const other = { html: "<title>Banco Mundial</title>", text: "Banco Mundial" };
    const directory = { html: '<a href="https://clinicasorriso.com.br">site</a>', text: "Clínica Sorriso Odontologia - Cuiabá" };

    expect(verifyAgainstPage(find("WEBSITE", "clinicasorriso.com.br", "https://clinicasorriso.com.br/"), own, "Clínica Sorriso Odontologia")).toBe(true);
    expect(verifyAgainstPage(find("WEBSITE", "clinicasorriso.com.br", "https://clinicasorriso.com.br/"), other, "Clínica Sorriso Odontologia")).toBe(false);
    expect(verifyAgainstPage(find("WEBSITE", "clinicasorriso.com.br", "https://guia.com/x"), directory, "Clínica Sorriso Odontologia")).toBe(true);
    expect(verifyAgainstPage(find("WEBSITE", "clinicasorriso.com.br", "https://guia.com/x"), other, "Clínica Sorriso Odontologia")).toBe(false);
  });
});

describe("busca com IA, ficha e decisão do usuário", () => {
  let companyId: number;

  const search = vi.fn();
  const fetchPage = vi.fn();

  const answer = (findings: unknown[], citations = CITED) =>
    search.mockResolvedValue({ text: JSON.stringify({ findings }), citations, searches: 1, model: "gpt-x" });

  beforeEach(async () => {
    db = await createMigratedTestDb();
    search.mockReset();
    fetchPage.mockReset();
    companyId = (
      await importCompany(
        { name: "Clínica Sorriso Odontologia", city: "Cuiabá", state: "MT", phone: "(65) 3333-1111", address: "Av. Brasil, 100", category: "Dentista" },
        "GOOGLE_PLACES",
      )
    ).id;
  });

  it("a ficha mostra o que tem e o que falta, com a ação para cada item", async () => {
    const ficha = await loadFicha(companyId);
    const row = (k: string) => ficha.rows.find((r) => r.key === k)!;

    expect(row("PHONE")).toMatchObject({ status: "OK", value: "(65) 3333-1111" });
    expect(row("ADDRESS")).toMatchObject({ status: "OK", source: "Google Maps" });
    expect(row("WEBSITE")).toMatchObject({ status: "MISSING" });
    expect(row("WEBSITE").action).toMatch(/site oficial/);
    expect(row("CNPJ").action).toMatch(/nunca inventa/);
    expect(ficha.missing).toEqual(expect.arrayContaining(["WEBSITE", "WHATSAPP", "EMAIL", "INSTAGRAM"]));
    expect(ficha.completeness).toEqual({ ok: 1, total: 8 });
  });

  it("guarda só sugestões (nada é aplicado) e marca quais a página confirmou", async () => {
    answer([
      f("WEBSITE", "https://clinicasorriso.com.br", CITED[0], "Clínica Sorriso Odontologia"),
      f("EMAIL", "contato@clinicasorriso.com.br", CITED[1], "contato@clinicasorriso.com.br"),
    ]);
    fetchPage.mockImplementation(async (url: string) =>
      url === CITED[0]
        ? { html: "<title>Clínica Sorriso Odontologia</title>", text: "Clínica Sorriso Odontologia Cuiabá" }
        : { html: "outra coisa", text: "sem e-mail aqui" },
    );

    const outcome = await searchCompanyWithAi(companyId, { search, fetchPage });

    expect(outcome).toMatchObject({ status: "DONE", found: 2, verified: 1, searches: 1 });
    expect(search.mock.calls[0][1]).toContain("Clínica Sorriso Odontologia");
    expect(search.mock.calls[0][1]).toContain("Procure SOMENTE");

    const stored = await listFindingsRepository(companyId);
    expect(stored.map((s) => `${s.field}:${s.status}:${s.verified}`)).toEqual([
      "WEBSITE:SUGGESTED:1",
      "EMAIL:SUGGESTED:0",
    ]);

    // Nada foi aplicado à empresa.
    expect((await getCompanyRepository(companyId))!.website).toBeNull();
    expect(await listChannelsRepository(companyId)).toEqual([]);

    const ficha = await loadFicha(companyId);
    expect(ficha.rows.find((r) => r.key === "WEBSITE")).toMatchObject({ status: "SUGGESTED", value: "clinicasorriso.com.br" });
    expect(ficha.missing).not.toContain("WEBSITE"); // já tem sugestão pendente
  });

  it("aceitar aplica o dado com a origem 'Busca com IA'; rejeitar descarta e não volta", async () => {
    answer([
      f("WEBSITE", "https://clinicasorriso.com.br", CITED[0], "x"),
      f("EMAIL", "contato@clinicasorriso.com.br", CITED[0], "x"),
    ]);
    fetchPage.mockResolvedValue({
      html: "<title>Clínica Sorriso Odontologia</title> contato@clinicasorriso.com.br",
      text: "Clínica Sorriso Odontologia",
    });

    await searchCompanyWithAi(companyId, { search, fetchPage });
    const [site, email] = await listFindingsRepository(companyId);

    await decideFinding(site.id, "ACCEPTED");
    await decideFinding(email.id, "REJECTED");

    const company = (await getCompanyRepository(companyId))!;
    expect(company).toMatchObject({ website: "https://clinicasorriso.com.br", domain: "clinicasorriso.com.br" });

    const channels = await listChannelsRepository(companyId);
    expect(channels.map((c) => `${c.kind}:${c.value}:${c.source}`)).toEqual(["WEBSITE:clinicasorriso.com.br:AI_SEARCH"]);

    // Decidir de novo não duplica nem desfaz.
    await expect(decideFinding(site.id, "ACCEPTED")).rejects.toThrow(/já foi decidida/);

    // Uma nova busca não ressuscita o e-mail rejeitado.
    answer([f("EMAIL", "contato@clinicasorriso.com.br", CITED[0], "x")]);
    await searchCompanyWithAi(companyId, { search, fetchPage });
    expect((await listFindingsRepository(companyId)).filter((s) => s.field === "EMAIL").map((s) => s.status)).toEqual(["REJECTED"]);
  });

  it("sugestão não confirmada só entra com confirmação explícita", async () => {
    answer([f("WHATSAPP", "65992250342", CITED[0], "x")]);
    fetchPage.mockResolvedValue(null); // página não abriu

    await searchCompanyWithAi(companyId, { search, fetchPage });
    const [w] = await listFindingsRepository(companyId);

    expect(w.verified).toBe(0);
    await expect(decideFinding(w.id, "ACCEPTED")).rejects.toThrow(/não confirmou/);
    expect((await listFindingsRepository(companyId))[0].status).toBe("SUGGESTED");

    await decideFinding(w.id, "ACCEPTED", { force: true });
    expect((await listChannelsRepository(companyId))[0]).toMatchObject({
      kind: "WHATSAPP", value: "65992250342", source: "AI_SEARCH",
    });
  });

  it("o site aprovado não apaga o link de rede social que estava no cadastro", async () => {
    await getSupabase().from("companies").update({ website: "https://www.instagram.com/clinicasorriso/" }).eq("id", companyId);
    answer([f("WEBSITE", "https://clinicasorriso.com.br", CITED[0], "x")]);
    fetchPage.mockResolvedValue({ html: "Clínica Sorriso Odontologia", text: "Clínica Sorriso Odontologia" });

    await searchCompanyWithAi(companyId, { search, fetchPage });
    await decideFinding((await listFindingsRepository(companyId))[0].id, "ACCEPTED");

    expect((await getCompanyRepository(companyId))!.website).toBe("https://clinicasorriso.com.br");
    expect((await listChannelsRepository(companyId)).map((c) => `${c.kind}:${c.value}`).sort()).toEqual([
      "INSTAGRAM:clinicasorriso",
      "WEBSITE:clinicasorriso.com.br",
    ]);
  });

  it("não busca quando nada falta e devolve erro claro se a IA responder lixo", async () => {
    const company = (await getCompanyRepository(companyId))!;
    const channels = ["WEBSITE", "WHATSAPP", "EMAIL", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "TIKTOK", "PHONE"].map((kind) => ({
      kind, value: kind === "PHONE" || kind === "WHATSAPP" ? "6533331111" : `${kind.toLowerCase()}@x.com`, label: "confirmado", source: "WEBSITE",
    }));
    expect(missingForSearch(buildFichaRows(company, channels as never, []))).toEqual([]);

    search.mockResolvedValue({ text: "isto não é json", citations: [], searches: 1, model: "m" });
    await expect(searchCompanyWithAi(companyId, { search, fetchPage })).rejects.toThrow(/formato inesperado/);
  });

  it("visão da lista: empresas x campos, completude e sugestões pendentes", async () => {
    const listId = await createListRepository({ name: "Odontologia — Cuiabá", segment: "Odontologia", city: "Cuiabá", queryText: "q", pages: 1 });
    await getSupabase().from("companies").update({ list_id: listId }).eq("id", companyId);
    await saveChannelsRepository(companyId, [
      { kind: "EMAIL", value: "a@clinica.com.br", url: "mailto:a@clinica.com.br", label: null, source: "WEBSITE" },
    ]);
    answer([f("WEBSITE", "https://clinicasorriso.com.br", CITED[0], "x")]);
    fetchPage.mockResolvedValue(null);
    await searchCompanyWithAi(companyId, { search, fetchPage });

    const [row] = await loadListFicha(listId);

    expect(row).toMatchObject({ companyId, ok: 2, total: 8, pendingSuggestions: 1 });
    expect(row.cells).toMatchObject({ PHONE: "OK", EMAIL: "OK", WEBSITE: "SUGGESTED", WHATSAPP: "MISSING", CNPJ: "MISSING" });
  });
});
