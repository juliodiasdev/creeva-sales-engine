import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import type { Company } from "../companies/company.types";
import { importCompany } from "../companies/company.service";
import { loadCallDossier } from "../daily/call.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { listSignalsRepository } from "../enrichment/enrichment.repository";
import { extractWebsiteFacts, failedWebsiteFacts, mergeWebsiteFacts } from "../enrichment/website.facts";
import type { WebsiteFacts } from "../enrichment/website.facts";
import { assessPresence } from "../presence/presence.engine";
import { getPresence } from "../presence/presence.service";
import { ensureServicesSeed } from "../services/services.service";
import { deriveAutomationSignal } from "../signals/signals.engine";
import { saveVisualReview } from "../visual/visual.service";

import { assessAutomation, automationGaps, automationReason } from "./automation.engine";
import type { AutomationReport } from "./automation.engine";

const company = (over: Partial<Company> = {}): Company =>
  ({
    id: 1, name: "Clínica Sorriso", segment: "Odontologia", category: "Dentista", city: "Cuiabá", state: "MT",
    website: "https://clinicasorriso.com.br", phone: "(65) 3333-1111", address: "Av. Brasil, 100", rating: 4.8, reviews_count: 40,
    company_size: null, ...over,
  }) as Company;

const page = (body: string, head = "") =>
  `<!doctype html><html><head><title>x</title><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`;

const read = (html: string): WebsiteFacts =>
  extractWebsiteFacts(html, { url: "https://clinicasorriso.com.br", finalUrl: "https://clinicasorriso.com.br/", httpStatus: 200 });

const ch = (kind: string, value = "x", label: string | null = null) => ({ kind, value, label });

const area = (r: AutomationReport, key: string) => r.areas.find((a) => a.key === key)!;

describe("detecção de ferramentas no código da página", () => {
  it("reconhece chat, agenda, pagamento, CRM e loja pelo endereço da ferramenta", () => {
    const facts = read(page(
      `<a href="https://calendly.com/clinica/consulta">Agende</a><iframe src="https://js.stripe.com/v3/"></iframe>`,
      `<script src="//embed.tawk.to/abc/default"></script>
       <script src="https://js-na1.hs-scripts.com/123.js"></script>
       <script src="https://sdk.mercadopago.com/js/v2"></script>
       <script>var s=document.createElement('script');s.src='https://cdn.shopify.com/s/files/x.js'</script>`,
    ));

    expect(facts.tools).toEqual(expect.arrayContaining([
      { category: "CHAT", name: "Tawk.to" },
      { category: "BOOKING", name: "Calendly" },
      { category: "PAYMENT", name: "Mercado Pago" },
      { category: "PAYMENT", name: "Stripe" },
      { category: "CRM", name: "HubSpot" },
      { category: "ECOMMERCE", name: "Shopify" },
    ]));
  });

  it("texto visível da página não conta como ferramenta, nem nome parecido", () => {
    const facts = read(page(
      `<p>Aceitamos PayPal, Mercado Pago e usamos Calendly e o iFood para pedidos.</p>
       <a href="https://www.local.com/x">local</a><a href="https://social.com.br/y">social</a>`,
    ));

    expect(facts.tools).toEqual([]);
  });

  it("junta as ferramentas da página de contato e avisa do Google Tag Manager", () => {
    const home = read(page("oi", `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>`));
    const contact = read(page(`<a href="https://wa.me/1">x</a>`, `<script src="https://embed.tawk.to/z/default"></script>`));

    expect(home.hasTagManager).toBe(true);
    expect(contact.hasTagManager).toBe(false);
    expect(mergeWebsiteFacts(home, contact).tools).toEqual([{ category: "CHAT", name: "Tawk.to" }]);
    expect(mergeWebsiteFacts(home, contact).hasTagManager).toBe(true);
    expect(failedWebsiteFacts("https://a.com", "timeout").tools).toEqual([]);
  });
});

describe("potencial de automação", () => {
  it("o que o código mostra vira 'já tem' com o nome da ferramenta", () => {
    const facts = read(page(
      `<a href="https://calendly.com/clinica">Agende sua consulta</a>`,
      `<script src="//embed.tawk.to/abc/default"></script><script src="https://js.hs-scripts.com/1.js"></script><script src="https://sdk.mercadopago.com/js/v2"></script>`,
    ));
    const r = assessAutomation({ company: company(), channels: [ch("WHATSAPP", "65992250342", "confirmado no site")], facts });

    expect(area(r, "ATENDIMENTO").state).toBe("ALREADY");
    expect(area(r, "AGENDA").state).toBe("ALREADY");
    expect(area(r, "AGENDA").evidence.map((e) => e.text).join(" ")).toMatch(/Calendly/);
    expect(area(r, "CAPTACAO").state).toBe("ALREADY");
    expect(area(r, "CAPTACAO").evidence[0].text).toMatch(/HubSpot/);
    expect(area(r, "PAGAMENTO").state).toBe("ALREADY");
    expect(area(r, "VENDAS").state).toBe("NOT_APPLICABLE");
    expect(r.summary).toMatch(/Automação encontrada em: .*Agenda/);
    expect(r.summary).not.toMatch(/Sem automação encontrada/);
  });

  it("dentista com site lido e nada encontrado: 'não encontrado (a confirmar)', com a origem de cada frase", () => {
    const r = assessAutomation({
      company: company(),
      channels: [ch("WHATSAPP", "65992250342", "confirmado no site")],
      facts: read(page("<form></form>")),
    });
    const agenda = area(r, "AGENDA");

    expect(agenda.state).toBe("NOT_FOUND");
    expect(agenda.evidence.map((e) => e.source)).toEqual(["SEGMENTO", "SITE"]);
    expect(agenda.evidence[1].text).toBe("Não encontramos agendamento online no código do site.");
    expect(automationReason(agenda)).toMatch(/\(a confirmar\)$/);
    expect(area(r, "ATENDIMENTO").state).toBe("NOT_FOUND");
    expect(area(r, "GESTAO").state).toBe("UNKNOWN");
    expect(area(r, "VENDAS").state).toBe("NOT_APPLICABLE");
    expect(r.level).toBe("HIGH");
    expect(r.summary).toMatch(/Sem automação encontrada em: .*\(a confirmar com a empresa\)/);
    expect(r.summary).toMatch(/Não dá para saber de fora: .*Gestão/);
    expect(automationGaps(r).map((a) => a.key)).toEqual(expect.arrayContaining(["AGENDA", "ATENDIMENTO", "CAPTACAO"]));
  });

  it("Google Tag Manager enfraquece o 'não encontrado' com um aviso", () => {
    const facts = read(page("<p>oi</p>", `<script src="https://www.googletagmanager.com/gtm.js?id=GTM-1"></script>`));
    const r = assessAutomation({ company: company(), channels: [], facts });

    expect(area(r, "AGENDA").evidence.at(-1)!.text).toMatch(/Google Tag Manager, que pode carregar ferramentas/);
  });

  it("sem site: 'não dá para saber', nunca 'não tem'; sem leitura do site, idem", () => {
    const noSite = assessAutomation({ company: company({ website: null }), channels: [ch("PHONE")], facts: null });

    expect(noSite.areas.filter((a) => a.state === "NOT_FOUND")).toEqual([]);
    expect(area(noSite, "AGENDA").state).toBe("UNKNOWN");
    expect(area(noSite, "AGENDA").evidence.at(-1)!.text).toMatch(/pode usar WhatsApp, Instagram ou outro canal/);
    expect(noSite.level).toBe("UNDEFINED");

    const unread = assessAutomation({ company: company(), channels: [], facts: null });
    expect(area(unread, "AGENDA").state).toBe("UNKNOWN");
    expect(area(unread, "AGENDA").evidence.at(-1)!.text).toMatch(/ainda não foi lido/);

    const failed = assessAutomation({ company: company(), channels: [], facts: failedWebsiteFacts("https://a.com", "HTTP 500", 500) });
    expect(area(failed, "AGENDA").state).toBe("UNKNOWN");
    expect(area(failed, "AGENDA").evidence.at(-1)!.text).toMatch(/O site não abriu/);
  });

  it("leitura antiga do site (sem lista de ferramentas) não vira 'não encontrado'", () => {
    const old = read(page("<p>oi</p>"));
    delete old.tools;

    const r = assessAutomation({ company: company(), channels: [], facts: old });

    expect(area(r, "AGENDA").state).toBe("UNKNOWN");
    expect(area(r, "AGENDA").evidence.at(-1)!.text).toMatch(/Leitura antiga/);
  });

  it("revisão do WhatsApp (feita por você) vale mais que a leitura do site", () => {
    const base = { company: company(), channels: [ch("WHATSAPP", "65992250342", "confirmado no site")], facts: read(page("<p>oi</p>")) };
    const review = (status: "OK" | "WARN" | "FAIL", note?: string) => [{
      target: "WHATSAPP" as const, answers: [{ id: "autoreply", status, note }], metrics: null, summary: null, source: "MANUAL" as const, reviewedAt: "",
    }];

    const fail = assessAutomation({ ...base, reviews: review("FAIL", "sem saudação") });
    expect(area(fail, "ATENDIMENTO").state).toBe("CONFIRMED_GAP");
    expect(area(fail, "ATENDIMENTO").evidence.map((e) => e.text).join(" ")).toMatch(/nenhuma \(sem saudação\)/);
    expect(automationReason(area(fail, "ATENDIMENTO"))).not.toMatch(/a confirmar/);

    expect(area(assessAutomation({ ...base, reviews: review("WARN") }), "ATENDIMENTO").state).toBe("CONFIRMED_GAP");
    expect(area(assessAutomation({ ...base, reviews: review("OK") }), "ATENDIMENTO").state).toBe("ALREADY");
  });

  it("loja, cardápio e cobrança só entram para quem tem sinal de precisar", () => {
    const store = assessAutomation({
      company: company({ segment: "Loja de roupas", category: "Loja de roupas", name: "Moda X" }),
      channels: [],
      facts: read(page("<p>oi</p>")),
    });
    expect(area(store, "VENDAS").state).toBe("NOT_FOUND");
    expect(area(store, "AGENDA").state).toBe("NOT_APPLICABLE");
    expect(area(store, "PAGAMENTO").state).toBe("NOT_APPLICABLE");

    const gym = assessAutomation({ company: company({ segment: "Academia", category: "Academia" }), channels: [], facts: read(page("<p>oi</p>")) });
    expect(area(gym, "PAGAMENTO").state).toBe("NOT_FOUND");
    expect(area(gym, "PAGAMENTO").evidence[0].source).toBe("SEGMENTO");

    const shop = assessAutomation({
      company: company({ segment: "Loja de roupas" }),
      channels: [],
      facts: read(page("<p>oi</p>", `<script src="https://cdn.shopify.com/x.js"></script>`)),
    });
    expect(area(shop, "VENDAS").state).toBe("ALREADY");
    expect(area(shop, "PAGAMENTO").state).toBe("NOT_FOUND");

    const food = assessAutomation({
      company: company({ segment: "Pizzaria" }), channels: [],
      facts: read(page(`<a href="https://www.ifood.com.br/delivery/x">Peça no iFood</a>`)),
    });
    expect(area(food, "VENDAS").state).toBe("ALREADY");
    expect(area(food, "VENDAS").evidence.at(-1)!.text).toMatch(/iFood/);
  });

  it("avaliações: só vira pergunta quando o Google mostra poucas ou notas baixas", () => {
    const facts = read(page("<p>oi</p>"));

    expect(area(assessAutomation({ company: company({ reviews_count: 300, rating: 4.8 }), channels: [], facts }), "AVALIACOES").state).toBe("NOT_APPLICABLE");

    const few = area(assessAutomation({ company: company({ reviews_count: 4, rating: 4.9 }), channels: [], facts }), "AVALIACOES");
    expect(few.state).toBe("UNKNOWN");
    expect(few.evidence[0]).toEqual({ source: "GOOGLE", text: "4 avaliação(ões) no Google, nota 4.9." });
  });

  it("gestão interna é sempre 'não dá para saber de fora', com os indicadores reais", () => {
    const r = assessAutomation({
      company: company({ reviews_count: 220, company_size: "DEMAIS" }),
      channels: [],
      facts: read(page("<p>oi</p>")),
    });

    expect(area(r, "GESTAO").state).toBe("UNKNOWN");
    expect(area(r, "GESTAO").evidence.map((e) => e.source)).toEqual(["GOOGLE", "CNPJ"]);
  });

  it("nenhum texto afirma o que não foi visto nem promete resultado", () => {
    const scenarios = [
      assessAutomation({ company: company(), channels: [ch("WHATSAPP", "65992250342", "provável (celular)")], facts: read(page("<form></form>")) }),
      assessAutomation({ company: company({ website: null }), channels: [], facts: null }),
      assessAutomation({ company: company({ segment: "Academia" }), channels: [], facts: read(page("<p>oi</p>")) }),
      assessAutomation({ company: company({ segment: "Pizzaria", reviews_count: 3 }), channels: [], facts: read(page("<p>oi</p>")) }),
    ];

    const banned = /manualmente|na m[ãa]o|empresa (n[ãa]o|nunca) |perde(m|ndo)?\b|economiz|poupa|aument(a|e|ar) (as )?vendas|garant|ROI|retorno financeiro|\d+\s?%/i;

    for (const r of scenarios) {
      const texts = [r.summary, ...r.areas.flatMap((a) => [a.question, ...a.evidence.map((e) => e.text)])];

      for (const t of texts) expect(t, t).not.toMatch(banned);
    }
  });
});

describe("integração com presença, sinais e ligação", () => {
  const html = page("<form></form>", `<link rel="canonical" href="https://clinicasorriso.com.br">`);
  const facts = read(html);

  const STRONG = page(
    `<img src="/logo.webp" alt="Clínica Sorriso" loading="lazy"><a href="https://wa.me/5565992250342">Fale conosco</a><a href="https://instagram.com/clinicasorriso">ig</a><a href="/privacidade">Política de privacidade</a><form></form><button>Agendar consulta</button><p>Agende sua consulta online. © 2026 Clínica Sorriso</p><a href="mailto:contato@clinica.com.br">e</a>`,
    `<meta name="description" content="Dentista em Cuiabá"><script src="https://www.googletagmanager.com/gtag/js"></script>`,
  );

  it("a presença carrega o relatório; só hipótese de automação NÃO vira 'hora de vender'", () => {
    const r = assessPresence({
      company: company({ reviews_count: 120 }),
      channels: [ch("PHONE", "6533331111"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("EMAIL", "contato@clinica.com.br"), ch("INSTAGRAM", "clinicasorriso"), ch("FACEBOOK", "c"), ch("LINKEDIN", "c")],
      facts: read(STRONG),
      now: new Date("2026-10-13T12:00:00Z"),
    });
    const reasons = r.offers.flatMap((o) => o.reasons);

    expect(r.automation!.areas.find((a) => a.key === "AGENDA")!.state).toBe("ALREADY");
    expect(r.automation!.areas.find((a) => a.key === "ATENDIMENTO")!.state).toBe("NOT_FOUND");
    expect(reasons.filter((t) => /^Atendimento/.test(t))[0]).toMatch(/\(a confirmar\)$/);
    expect(r.moment).toBe("NO_GAP");
    expect(r.position).not.toMatch(/boca a boca|travam|ganho está/);
  });

  it("falta CONFIRMADA na revisão (e não só hipótese) já é hora de vender", () => {
    const r = assessPresence({
      company: company({ reviews_count: 120 }),
      channels: [ch("PHONE", "6533331111"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("EMAIL", "contato@clinica.com.br"), ch("INSTAGRAM", "clinicasorriso"), ch("FACEBOOK", "c"), ch("LINKEDIN", "c")],
      facts: read(STRONG),
      reviews: [{ target: "WHATSAPP", answers: [{ id: "autoreply", status: "FAIL" }], metrics: null, summary: null, source: "MANUAL", reviewedAt: "" }],
      now: new Date("2026-10-13T12:00:00Z"),
    });

    expect(r.moment).toBe("READY");
    expect(r.offers.some((o) => o.service === "SISTEMA_AUTOMACAO")).toBe(true);
  });

  it("o sinal só existe com lacuna aplicável e lembra que precisa ser confirmado", () => {
    const withGap = assessAutomation({ company: company(), channels: [], facts });
    const signal = deriveAutomationSignal(withGap)!;

    expect(signal).toMatchObject({ type: "AUTOMATION_GAP", source: "WEBSITE", confidence: 0.5 });
    expect(signal.evidence).toMatch(/precisa ser confirmado com a empresa/);

    const none = assessAutomation({ company: company({ website: null }), channels: [], facts: null });
    expect(deriveAutomationSignal(none)).toBeNull();
  });

  describe("no banco", () => {
    beforeEach(async () => {
      await createMigratedTestDb();
      await ensureServicesSeed();
    });

    it("enriquecer gera o sinal, a presença guarda a automação e a ligação recebe as perguntas", async () => {
      const id = (await importCompany({ name: "Clínica Sorriso", city: "Cuiabá", segment: "Odontologia", website: "http://clinicasorriso.com.br", phone: "(65) 3333-1111" }, "GOOGLE_PLACES")).id;

      await enrichCompany(id, vi.fn().mockResolvedValue(facts));

      expect((await listSignalsRepository(id)).map((s) => s.type)).toContain("AUTOMATION_GAP");
      expect((await getPresence(id))!.report.automation!.areas.length).toBe(7);

      const dossier = await loadCallDossier(id);
      const agenda = dossier.automation.find((a) => a.area === "Agenda e agendamento")!;

      expect(agenda).toMatchObject({ state: "NOT_FOUND", stateLabel: "Não encontrado (a confirmar)" });
      expect(agenda.question).toMatch(/Como o cliente marca horário hoje/);
      expect(dossier.automation.map((a) => a.state)).not.toContain("ALREADY");
      expect(dossier.automation.map((a) => a.state)).not.toContain("NOT_APPLICABLE");
    });

    it("a revisão do WhatsApp confirma a falta e o sinal passa a ser da revisão", async () => {
      const id = (await importCompany({ name: "Clínica Sorriso", city: "Cuiabá", segment: "Odontologia", website: "http://clinicasorriso.com.br", phone: "(65) 99225-0342" }, "GOOGLE_PLACES")).id;
      await enrichCompany(id, vi.fn().mockResolvedValue(facts));

      await saveVisualReview(id, "WHATSAPP", { source: "MANUAL", answers: [{ id: "autoreply", status: "FAIL" }] });

      const signal = (await listSignalsRepository(id)).find((s) => s.type === "AUTOMATION_GAP")!;
      expect(signal).toMatchObject({ source: "VISUAL_REVIEW" });
      expect((await getPresence(id))!.report.automation!.areas.find((a) => a.key === "ATENDIMENTO")!.state).toBe("CONFIRMED_GAP");
    });
  });
});
