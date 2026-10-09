import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildExportData, toCsv } from "./export.service";
import { buildWorkbook } from "./workbook";
import { cleanBusinessName } from "./names";

describe("cleanBusinessName", () => {
  it("picks the business name out of keyword-stuffed Google titles", () => {
    expect(cleanBusinessName("Dentista em Cuiabá MT | Myrelief | Clínica Odontológica | Implante Dentário | Faceta dentária")).toBe("Myrelief");
    expect(cleanBusinessName("Dentista em Cuiabá - Dra Mariana Lima Pereira")).toBe("Dra Mariana Lima Pereira");
    expect(cleanBusinessName("Dra. Paula Viana | Dentista | Bairro Lixeira - Cuiabá")).toBe("Dra. Paula Viana");
    expect(cleanBusinessName("Odonto Alfa - Clínica Odontológica em Cuiabá")).toBe("Odonto Alfa");
    expect(cleanBusinessName("Dra. Katia Boaventura Dentista em Cuiabá | Facetas em resina | Reabilitação Oral | Estética Dental | Implantes")).toBe("Dra. Katia Boaventura");
    expect(cleanBusinessName("Natalia Dela Costa Dentista Cuiabá")).toBe("Natalia Dela Costa");
    expect(cleanBusinessName("Viva Odontologia Cuiabá | Dentista Jardim Imperial")).toBe("Viva Odontologia Cuiabá");
    expect(cleanBusinessName("ODONTO MEDICINA 🦷")).toBe("ODONTO MEDICINA 🦷");
    expect(cleanBusinessName("Nuke Studio Estética Automotiva")).toBe("Nuke Studio Estética Automotiva");
  });
});

const company = (id: number, name: string, extra = {}) =>
  ({ id, name, segment: "odontologia", city: "Cuiabá", state: "MT", address: "Av. Brasil, 10 - Centro, Cuiabá - MT, 78000-000, Brasil", rating: 4.8, reviews_count: 120, lead_status: "QUALIFIED", created_at: "2026-10-08T10:00:00Z", ...extra }) as never;

const ch = (company_id: number, kind: string, value: string, url: string | null = null, label: string | null = null, id = Math.random()) =>
  ({ id, company_id, kind, value, url, label, source: "WEBSITE" }) as never;

const input = () => ({
  companies: [
    company(1, "Dentista em Cuiabá MT | Myrelief | Clínica Odontológica", { lead_status: "ENRICHED" }),
    company(1, "repetida"),
    company(2, "Odonto Alfa", { lead_status: "READY" }),
    company(3, "Print Car Estética Automotiva", { lead_status: "DISCOVERED", segment: "estética automotiva", rating: null, reviews_count: null }),
    company(4, "Só Instagram", { lead_status: "ENRICHED" }),
  ],
  channels: [
    ch(1, "PHONE", "6530282263", "tel:+556530282263"),
    ch(1, "PHONE", "65999472815", "tel:+5565999472815"),
    ch(1, "WHATSAPP", "65999472815", "https://wa.me/5565999472815", "provável (celular)"),
    ch(1, "WEBSITE", "myrelief.com.br", "https://lp.myrelief.com.br/"),
    ch(2, "WHATSAPP", "65984294980", "https://wa.me/5565984294980", "confirmado no site"),
    ch(2, "PHONE", "65984294980"),
    ch(2, "EMAIL", "comercial@odontoalfamt.com.br"),
    ch(2, "INSTAGRAM", "odontoalfaoficial", "https://www.instagram.com/odontoalfaoficial/"),
    ch(4, "INSTAGRAM", "soinsta", "https://www.instagram.com/soinsta/"),
  ],
  approaches: [
    { id: 1, company_id: 1, channel: "WHATSAPP", service_key: "LANDING_PAGE", angle: "x", message: "Olá, Myrelief!\nPodemos ajudar com uma landing page.", evidence_used: null, source: "TEMPLATE", created_at: "" },
    { id: 2, company_id: 2, channel: "EMAIL", service_key: "SUPORTE", angle: "x", message: "E-mail para Odonto Alfa", evidence_used: null, source: "AI", created_at: "" },
  ] as never,
  scores: new Map([[1, 31], [2, 80]]),
  prospectStatus: new Map([[2, "CONTACTED"]]),
  sources: new Map([[1, "GOOGLE_PLACES"], [2, "GOOGLE_PLACES"], [3, "GOOGLE_PLACES"]]),
  serviceNames: new Map([["LANDING_PAGE", "Landing pages"], ["SUPORTE", "Suporte contínuo"]]),
});

describe("buildExportData", () => {
  const data = buildExportData(input());
  const by = (n: string) => data.companies.find((c) => c.name === n)!;

  it("one row per company, clean names, original kept", () => {
    expect(data.companies).toHaveLength(4);
    expect(by("Myrelief").originalName).toContain("Dentista em Cuiabá MT");
  });

  it("separates landline from whatsapp, no repeated number", () => {
    const m = by("Myrelief");
    expect(m).toMatchObject({ whatsapp: "(65) 99947-2815", whatsappProbable: true, landline: "(65) 3028-2263" });
    const a = by("Odonto Alfa");
    expect(a.landline).toBe(""); // o único telefone já é o WhatsApp
    expect(a.whatsappProbable).toBe(false);
  });

  it("portuguese statuses, contact flags and what is missing", () => {
    expect(by("Myrelief")).toMatchObject({ leadStatus: "Enriquecida", hasContact: true });
    expect(by("Odonto Alfa")).toMatchObject({ leadStatus: "Em abordagem", prospectStatus: "Contatado", service: "Suporte contínuo" });
    expect(by("Print Car Estética Automotiva")).toMatchObject({ hasContact: false, leadStatus: "Nova" });
    expect(by("Print Car Estética Automotiva").missing).toContain("Enriquecer");
    expect(by("Só Instagram").hasContact).toBe(true);
    expect(data.approaches).toHaveLength(2);
  });

  it("csv is flat, quoted and protected", () => {
    const csv = toCsv(data.companies);
    expect(csv.startsWith("﻿Empresa;Segmento")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(5);
  });
});

describe("buildWorkbook", () => {
  it("creates a professional multi-sheet file with working links and filters", async () => {
    const bytes = await buildWorkbook(buildExportData(input()), new Date("2026-10-08T15:00:00Z"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);

    expect(wb.worksheets.map((s) => s.name)).toEqual(["Resumo", "Contatos", "Sem contato", "Abordagens"]);

    const contacts = wb.getWorksheet("Contatos")!;
    // prospect ativo (pontuação 80) vem antes; só 3 empresas têm contato
    expect(contacts.rowCount).toBe(4);
    expect(contacts.getCell("A2").value).toBe("Odonto Alfa");
    expect(contacts.getCell("H2").value).toMatchObject({ hyperlink: "https://wa.me/5565984294980" });
    expect(contacts.getCell("J2").value).toMatchObject({ hyperlink: "mailto:comercial@odontoalfamt.com.br" });
    expect(contacts.getCell("L2").value).toMatchObject({ text: "@odontoalfaoficial" });
    expect(contacts.views[0]).toMatchObject({ state: "frozen", ySplit: 1, xSplit: 1 });
    expect(contacts.autoFilter).toBeTruthy();

    const semContato = wb.getWorksheet("Sem contato")!;
    expect(semContato.rowCount).toBe(2);
    expect(semContato.getCell("A2").value).toBe("Print Car Estética Automotiva");

    expect(wb.getWorksheet("Abordagens")!.rowCount).toBe(3);
    expect(wb.getWorksheet("Resumo")!.getCell("A1").value).toBe("Creava Digital - Agência");
  });
});
