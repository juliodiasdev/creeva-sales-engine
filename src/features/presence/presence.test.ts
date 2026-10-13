import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import type { Company } from "../companies/company.types";
import { importCompany } from "../companies/company.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { extractWebsiteFacts, failedWebsiteFacts } from "../enrichment/website.facts";
import type { WebsiteFacts } from "../enrichment/website.facts";
import { ensureServicesSeed } from "../services/services.service";
import { assessPresence } from "./presence.engine";
import { assessAndSavePresence, getPresence, listPresenceSummaries } from "./presence.service";

const NOW = new Date("2026-10-13T12:00:00Z");

const company = (over: Partial<Company> = {}): Company =>
  ({
    id: 1, name: "Clínica Sorriso", segment: "Odontologia", category: "Dentista", city: "Cuiabá", state: "MT",
    website: null, phone: "(65) 3333-1111", address: "Av. Brasil, 100", rating: 4.8, reviews_count: 120,
    instagram: null, domain: null, ...over,
  }) as Company;

const GOOD_HTML = `<!doctype html><html lang="pt-BR"><head><title>Clínica Sorriso</title><meta name="description" content="Dentista em Cuiabá">
<meta name="viewport" content="width=device-width"><script src="https://www.googletagmanager.com/gtag/js"></script></head>
<body><a href="https://wa.me/5565992250342">Fale conosco</a><a href="https://instagram.com/clinicasorriso">ig</a>
<a href="/privacidade">Política de privacidade</a><form></form><button>Agendar consulta</button>
<p>Agende sua consulta online. © 2026 Clínica Sorriso</p><a href="mailto:contato@clinica.com.br">e</a></body></html>`;

const facts = (html: string, over: Partial<WebsiteFacts> = {}): WebsiteFacts => ({
  ...extractWebsiteFacts(html, { url: "https://clinicasorriso.com.br", finalUrl: "https://clinicasorriso.com.br/", httpStatus: 200 }),
  loadMs: 900,
  ...over,
});

const ch = (kind: string, value = "x", label: string | null = null) => ({ kind, value, label });

describe("assessPresence", () => {
  it("empresa sem site nem redes: sem presença digital, hora de vender o site", () => {
    const r = assessPresence({ company: company(), channels: [ch("PHONE", "6533331111")], facts: null, now: NOW });

    expect(r.level).toBe("NONE");
    expect(r.moment).toBe("READY");
    expect(r.position).toMatch(/Sem site próprio nem redes sociais encontrados/);
    expect(r.offers[0].service).toBe("SITE_LOJA");
    expect(r.offers[0].reasons[0]).toMatch(/Tem site próprio/);
    expect(r.gaps.map((g) => g.id)).toContain("site.exists");
  });

  it("com site cadastrado mas ainda não lido: faltam dados (não finge medir)", () => {
    const r = assessPresence({ company: company({ website: "https://clinicasorriso.com.br" }), channels: [ch("PHONE", "6533331111")], facts: null, now: NOW });

    expect(r.moment).toBe("NEEDS_DATA");
    expect(r.blockers[0]).toMatch(/ainda não foi lido/);
    expect(r.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.online")!.status).toBe("UNKNOWN");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("site que não abre: lacuna grave e orientação de conferir o endereço", () => {
    const r = assessPresence({
      company: company({ website: "https://clinicasorriso.com.br" }),
      channels: [],
      facts: failedWebsiteFacts("https://clinicasorriso.com.br", "ENOTFOUND"),
      now: NOW,
    });

    expect(r.gaps[0]).toMatchObject({ id: "site.online", status: "FAIL" });
    expect(r.blockers[0]).toMatch(/não abriu/);
    expect(r.moment).toBe("NEEDS_DATA");
  });

  it("site fraco (sem https, celular, botão, WhatsApp): presença básica e ofertas com motivos reais", () => {
    const weak = extractWebsiteFacts("<html><head><title>Clínica</title></head><body>© 2015 Clínica</body></html>", {
      url: "http://clinicasorriso.com.br", finalUrl: "http://clinicasorriso.com.br/", httpStatus: 200,
    });

    const r = assessPresence({
      company: company({ website: "http://clinicasorriso.com.br", rating: 3.5, reviews_count: 4 }),
      channels: [ch("PHONE", "6533331111")],
      facts: { ...weak, loadMs: 5200 },
      now: NOW,
    });

    const site = r.dimensions.find((d) => d.key === "SITE")!;
    const status = (id: string) => site.checks.find((c) => c.id === id)!.status;

    expect(["site.https", "site.mobile", "site.cta", "site.whatsapp", "site.speed", "site.fresh"].map(status)).toEqual([
      "FAIL", "FAIL", "FAIL", "FAIL", "FAIL", "FAIL",
    ]);
    expect(r.level).toBe("BASIC");
    expect(r.moment).toBe("READY");
    expect(r.offers.map((o) => o.service)).toContain("SITE_LOJA");
    expect(r.offers[0].reasons.join(" ")).toMatch(/HTTPS|celular/);
  });

  it("presença forte: avançada, com poucas brechas", () => {
    const r = assessPresence({
      company: company({ website: "https://clinicasorriso.com.br" }),
      channels: [ch("PHONE", "6533331111"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("EMAIL", "contato@clinica.com.br"), ch("INSTAGRAM", "clinicasorriso"), ch("FACEBOOK", "clinicasorriso"), ch("LINKEDIN", "company/clinica")],
      facts: facts(GOOD_HTML),
      now: NOW,
    });

    expect(r.level).toBe("ADVANCED");
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.strengths.length).toBeGreaterThan(0);
    // 20% da nota depende da revisão visual (Instagram/site), ainda não feita.
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
    expect(r.confidence).toBeLessThan(0.85);
    expect(r.pending).toEqual(expect.arrayContaining(["Revisão visual: Instagram", "Revisão visual: Visual do site"]));
    expect(r.position).toMatch(/Presença avançada: nota \d+\/100/);
  });

  it("WhatsApp só 'provável' é aviso, não OK; o que não dá para medir nunca derruba a nota", () => {
    const base = {
      company: company({ website: "https://clinicasorriso.com.br" }),
      facts: facts(GOOD_HTML, { copyrightYear: null, loadMs: null }),
      now: NOW,
    };

    const probable = assessPresence({ ...base, channels: [ch("WHATSAPP", "65992250342", "provável (celular)")] });
    const confirmed = assessPresence({ ...base, channels: [ch("WHATSAPP", "65992250342", "confirmado no site")] });
    const status = (r: ReturnType<typeof assessPresence>) =>
      r.dimensions.find((d) => d.key === "CONTACT")!.checks.find((c) => c.id === "contact.whatsapp")!.status;

    expect(status(probable)).toBe("WARN");
    expect(status(confirmed)).toBe("OK");
    expect(confirmed.score!).toBeGreaterThan(probable.score!);
    expect(confirmed.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.speed")!.status).toBe("UNKNOWN");
  });

  it("agendamento e loja virtual só são cobrados do segmento que precisa", () => {
    const html = "<html><head><title>A</title><meta name='viewport' content='x'></head><body>Olá</body></html>";
    const dentist = assessPresence({ company: company({ website: "https://a.com.br" }), channels: [], facts: facts(html), now: NOW });
    const store = assessPresence({ company: company({ website: "https://a.com.br", segment: "Loja de roupas", category: "Loja de roupas" }), channels: [], facts: facts(html), now: NOW });
    const ids = (r: ReturnType<typeof assessPresence>) => r.dimensions.flatMap((d) => d.checks).map((c) => c.id);

    expect(ids(dentist)).toContain("conv.booking");
    expect(ids(dentist)).not.toContain("conv.shop");
    expect(ids(store)).toContain("conv.shop");
  });

  it("site em construtor gratuito não conta como domínio próprio", () => {
    const r = assessPresence({ company: company({ website: "https://clinica.wixsite.com/site" }), channels: [], facts: facts(GOOD_HTML), now: NOW });

    expect(r.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.domain")!.status).toBe("FAIL");
  });
});

const OLD_HTML = `<html><head><title>Casa Velha</title></head><body bgcolor="#ffffff">
<table width="800" cellpadding="0"><tr><td><table width="100%" bgcolor="#eee"><tr><td><font color="red">Bem-vindo</font>
<center><marquee>Promoção!</marquee></center><script src="/js/jquery-1.12.4.min.js"></script></td></tr></table></td></tr></table>
<p>Copyright 2012</p></body></html>`;

const review = (target: "INSTAGRAM" | "WHATSAPP" | "SITE", answers: { id: string; status: "OK" | "WARN" | "FAIL"; note?: string }[], metrics = null as never) => ({
  target, answers, metrics, summary: null, source: "MANUAL" as const, reviewedAt: NOW.toISOString(),
});

const dim = (r: ReturnType<typeof assessPresence>, key: string) => r.dimensions.find((d) => d.key === key)!;

describe("site antigo ou novo", () => {
  it("código antigo (doctype, tabelas, tags obsoletas, jQuery 1.x) vira problema com os sinais citados", () => {
    const r = assessPresence({ company: company({ website: "https://casavelha.com.br" }), channels: [], facts: facts(OLD_HTML, { copyrightYear: 2012 }), now: NOW });
    const legacy = dim(r, "SITE").checks.find((c) => c.id === "site.legacy")!;

    expect(legacy.status).toBe("FAIL");
    expect(legacy.detail).toMatch(/doctype/);
    expect(legacy.detail).toMatch(/tabelas/);
    expect(legacy.detail).toMatch(/tags obsoletas/);
    expect(legacy.detail).toMatch(/jQuery antigo/);
    expect(r.gaps.map((g) => g.id)).toContain("site.legacy");
  });

  it("um sinal fraco sozinho é só atenção; tabela de dados simples não é layout antigo", () => {
    const dataTable = `<!doctype html><html><head><title>x</title><meta name="viewport" content="width=device-width"></head><body><table width="100%" cellspacing="0"><tr><td>Plano</td><td>Preço</td></tr></table><table width="50%"><tr><td>a</td></tr></table><center>oi</center></body></html>`;
    const r = assessPresence({ company: company({ website: "https://a.com.br" }), channels: [], facts: facts(dataTable), now: NOW });
    const legacy = dim(r, "SITE").checks.find((c) => c.id === "site.legacy")!;

    expect(legacy.status).toBe("WARN");
    expect(legacy.detail).toMatch(/tags de formatação obsoletas/);
    expect(legacy.detail).not.toMatch(/tabelas/);
    expect(r.gaps.find((g) => g.id === "site.legacy")!.status).toBe("WARN");
  });

  it("imagens decorativas não contam; sem imagens de conteúdo no HTML é 'não medido', não problema", () => {
    const only = `<!doctype html><html><head><title>x</title></head><body><img src="/a.png" alt=""><img src="/b.png" role="presentation"></body></html>`;
    const r = assessPresence({ company: company({ website: "https://a.com.br" }), channels: [], facts: facts(only), now: NOW });

    expect(dim(r, "SITE").checks.find((c) => c.id === "site.images")!.status).toBe("UNKNOWN");
  });

  it("site moderno não é acusado de antigo", () => {
    const r = assessPresence({ company: company({ website: "https://clinicasorriso.com.br" }), channels: [], facts: facts(GOOD_HTML), now: NOW });

    expect(dim(r, "SITE").checks.find((c) => c.id === "site.legacy")!.status).toBe("OK");
  });

  it("leitura antiga (sem os campos novos) é 'não medido', não problema", () => {
    const old = facts(GOOD_HTML);
    delete old.legacyCues;
    delete old.images;
    const r = assessPresence({ company: company({ website: "https://clinicasorriso.com.br" }), channels: [], facts: old, now: NOW });

    expect(dim(r, "SITE").checks.find((c) => c.id === "site.legacy")!.status).toBe("UNKNOWN");
    expect(dim(r, "SITE").checks.find((c) => c.id === "site.images")!.status).toBe("UNKNOWN");
  });

  it("site antigo impede 'presença avançada', mesmo com o resto em dia", () => {
    const strong = [ch("PHONE", "6533331111"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("EMAIL", "contato@clinica.com.br"), ch("INSTAGRAM", "clinicasorriso"), ch("FACEBOOK", "clinicasorriso"), ch("LINKEDIN", "company/clinica")];
    const base = { company: company({ website: "https://clinicasorriso.com.br" }), channels: strong, now: NOW };

    const modern = assessPresence({ ...base, facts: facts(GOOD_HTML) });
    const old = assessPresence({ ...base, facts: facts(GOOD_HTML, { legacyCues: ["layout montado com tabelas", "usa Flash"] }) });
    const noBanners = assessPresence({ ...base, facts: facts(GOOD_HTML), reviews: [review("INSTAGRAM", [{ id: "banners", status: "FAIL" }])] });

    expect(modern.level).toBe("ADVANCED");
    expect(old.score!).toBeGreaterThanOrEqual(70);
    expect(old.level).toBe("INTERMEDIATE");
    expect(old.position).toMatch(/imagem defasada/);
    expect(old.moment).toBe("READY");
    expect(noBanners.level).toBe("INTERMEDIATE");
    expect(noBanners.offers[0].service).toBe("DESIGN_SOCIAL");
  });

  it("a medição do Google PageSpeed entra como item do site", () => {
    const metrics = { strategy: "mobile", performance: 38, accessibility: 80, bestPractices: 70, seo: 90, lcpMs: 6200, measuredAt: NOW.toISOString() } as never;
    const r = assessPresence({
      company: company({ website: "https://clinicasorriso.com.br" }), channels: [], facts: facts(GOOD_HTML), now: NOW,
      reviews: [review("SITE", [], metrics)],
    });
    const psi = dim(r, "SITE").checks.find((c) => c.id === "site.psi")!;

    expect(psi.status).toBe("FAIL");
    expect(psi.detail).toMatch(/38\/100/);
    expect(psi.detail).toMatch(/6\.2 s/);
  });
});

describe("revisão visual: Instagram, WhatsApp e banners", () => {
  const base = {
    company: company({ website: "https://clinicasorriso.com.br" }),
    channels: [ch("INSTAGRAM", "clinicasorriso"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("PHONE", "6533331111")],
    facts: facts(GOOD_HTML),
    now: NOW,
  };

  it("pesos das dimensões somam 100", () => {
    const r = assessPresence(base);

    expect(r.dimensions.reduce((n, d) => n + d.weight, 0)).toBe(100);
  });

  it("antes da revisão: itens 'não medidos', pendência listada e a nota não é afetada", () => {
    const r = assessPresence(base);
    const visual = dim(r, "VISUAL");

    expect(visual.score).toBeNull();
    expect(visual.checks.map((c) => c.status)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    expect(r.pending).toEqual(["Revisão visual: Instagram", "Revisão visual: WhatsApp Business", "Revisão visual: Visual do site"]);
  });

  it("sem banners no Instagram: lacuna real que vira oferta de Design e redes sociais", () => {
    const r = assessPresence({
      ...base,
      reviews: [review("INSTAGRAM", [
        { id: "banners", status: "FAIL", note: "só fotos soltas dos produtos" },
        { id: "identity", status: "WARN" },
        { id: "avatar", status: "OK" },
      ])],
    });
    const offer = r.offers.find((o) => o.service === "DESIGN_SOCIAL")!;

    expect(offer).toBeTruthy();
    expect(offer.reasons[0]).toMatch(/Instagram: Banners e artes de divulgação/);
    expect(offer.reasons[0]).toMatch(/só fotos soltas dos produtos/);
    expect(dim(r, "VISUAL").score).not.toBeNull();
    expect(r.pending).not.toContain("Revisão visual: Instagram");
    // item não respondido fica "não avaliado", sem derrubar a nota
    expect(dim(r, "VISUAL").checks.find((c) => c.id === "visual.instagram.bio")!.status).toBe("UNKNOWN");
  });

  it("revisar aumenta a confiança da avaliação", () => {
    const before = assessPresence(base);
    const all = (t: "INSTAGRAM" | "WHATSAPP" | "SITE", ids: string[]) => review(t, ids.map((id) => ({ id, status: "OK" as const })));
    const after = assessPresence({
      ...base,
      reviews: [
        all("INSTAGRAM", ["avatar", "bio", "link", "identity", "banners", "recency", "highlights"]),
        all("WHATSAPP", ["business", "photo", "profile", "catalog", "autoreply"]),
        all("SITE", ["design", "hero", "consistency"]),
      ],
    });

    expect(after.confidence).toBeGreaterThan(before.confidence);
    expect(after.pending).toEqual([]);
  });

  it("sem Instagram cadastrado: criar o perfil já é oferta de Design e redes sociais", () => {
    const r = assessPresence({ ...base, channels: [ch("PHONE", "6533331111")] });

    expect(r.gaps.find((g) => g.id === "social.instagram")!.service).toBe("DESIGN_SOCIAL");
    expect(r.offers.some((o) => o.service === "DESIGN_SOCIAL")).toBe(true);
    // sem perfil, não há o que revisar no Instagram
    expect(r.pending).not.toContain("Revisão visual: Instagram");
  });

  it("WhatsApp só 'provável' não pede revisão de perfil", () => {
    const r = assessPresence({ ...base, channels: [ch("WHATSAPP", "65992250342", "provável (celular)")] });

    expect(r.pending).not.toContain("Revisão visual: WhatsApp Business");
  });

  it("empresa sem site, Instagram nem WhatsApp: dimensão visual não pesa na confiança", () => {
    const r = assessPresence({ company: company(), channels: [ch("PHONE", "6533331111")], facts: null, now: NOW });

    expect(dim(r, "VISUAL").checks).toHaveLength(0);
    expect(r.pending).toEqual([]);
  });
});

describe("presença salva no banco", () => {
  beforeEach(async () => {
    await createMigratedTestDb();
    await ensureServicesSeed();
  });

  it("o enriquecimento avalia e guarda; reavaliar não precisa ler o site de novo", async () => {
    const id = (await importCompany({ name: "Clínica Sorriso", city: "Cuiabá", website: "http://clinicasorriso.com.br", phone: "(65) 3333-1111" }, "GOOGLE_PLACES")).id;
    const crawler = vi.fn().mockResolvedValue(facts("<html><head><title>x</title></head><body>oi</body></html>", { https: false }));

    await enrichCompany(id, crawler);

    const saved = await getPresence(id);
    expect(saved).toMatchObject({ companyId: id, moment: "READY" });
    expect(saved!.report.gaps.length).toBeGreaterThan(0);

    crawler.mockClear();
    await assessAndSavePresence(id);
    expect(crawler).not.toHaveBeenCalled();

    const summaries = await listPresenceSummaries([id, 999]);
    expect(summaries.get(id)).toMatchObject({ level: saved!.level });
    expect(summaries.has(999)).toBe(false);
  });
});
