import { describe, expect, it } from "vitest";

import {
  isMobilePhone,
  normalizeEmail,
  socialProfile,
  whatsappNumberFromUrl,
} from "../../lib/normalize";

import { buildChannels, channelOpenUrl } from "./channels.engine";
import { extractWebsiteFacts } from "../enrichment/website.facts";

describe("normalizers", () => {
  it("whatsapp number from several link formats", () => {
    expect(whatsappNumberFromUrl("https://wa.me/5565999991234?text=oi")).toBe("65999991234");
    expect(whatsappNumberFromUrl("https://api.whatsapp.com/send?phone=5565999991234&text=x")).toBe("65999991234");
    expect(whatsappNumberFromUrl("https://wa.me/message/ABC")).toBeNull();
  });

  it("emails: valid and junk", () => {
    expect(normalizeEmail("mailto:Contato@Clinica.com.br?subject=x")).toBe("contato@clinica.com.br");
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("noreply@x.com")).toBeNull();
    expect(normalizeEmail("abc")).toBeNull();
  });

  it("social profiles: canonical, and ignores shares/posts", () => {
    expect(socialProfile("https://www.instagram.com/Clinica.Sorriso/?hl=pt")).toMatchObject({ kind: "INSTAGRAM", handle: "clinica.sorriso" });
    expect(socialProfile("https://instagram.com/p/ABC123/")).toBeNull();
    expect(socialProfile("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(socialProfile("https://www.linkedin.com/company/acme/")).toMatchObject({ kind: "LINKEDIN", handle: "company/acme" });
    expect(socialProfile("https://www.youtube.com/@canal")).toMatchObject({ kind: "YOUTUBE", handle: "@canal" });
    expect(socialProfile("https://example.com/x")).toBeNull();
  });

  it("mobile detection", () => {
    expect(isMobilePhone("65999991234")).toBe(true);
    expect(isMobilePhone("6533331234")).toBe(false);
  });
});

const HTML = `<html><body>
<a href="https://wa.me/5565988887777">WhatsApp</a>
<a href="mailto:contato@sorriso.com.br">email</a>
<a href="https://instagram.com/sorriso">ig</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=1">share</a>
<a href="/contato">Fale conosco</a>
<p>Ligue (65) 3333-1111 ou escreva para vendas@sorriso.com.br</p></body></html>`;

describe("buildChannels", () => {
  const facts = extractWebsiteFacts(HTML, { url: "https://sorriso.com.br", finalUrl: "https://sorriso.com.br/", httpStatus: 200 });

  it("extracts real channels from site facts, no invented data", () => {
    expect(facts.contactPageUrl).toBe("https://sorriso.com.br/contato");
    expect(facts.emails).toEqual(expect.arrayContaining(["contato@sorriso.com.br", "vendas@sorriso.com.br"]));
    expect(Object.keys(facts.socialLinks)).toEqual(["instagram"]);
  });

  it("merges google + site, confirmed whatsapp wins over probable, no duplicates", () => {
    const channels = buildChannels(
      { website: "https://www.sorriso.com.br", phone: "(65) 98888-7777", instagram: null },
      facts,
    );
    const wa = channels.filter((c) => c.kind === "WHATSAPP");
    expect(wa).toHaveLength(1);
    expect(wa[0].label).toBe("confirmado no site");
    expect(channels.filter((c) => c.kind === "PHONE").map((c) => c.value).sort()).toEqual(["6533331111", "65988887777"]);
    expect(channels.find((c) => c.kind === "INSTAGRAM")?.value).toBe("sorriso");
    expect(channels.find((c) => c.kind === "WEBSITE")?.value).toBe("sorriso.com.br");
    const keys = channels.map((c) => `${c.kind}:${c.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("landline is never offered as whatsapp; nothing when no data", () => {
    const channels = buildChannels({ website: null, phone: "(65) 3333-1111", instagram: null }, null);
    expect(channels.map((c) => c.kind)).toEqual(["PHONE"]);
    expect(buildChannels({ website: null, phone: null, instagram: null }, null)).toEqual([]);
  });

  it("builds open links with prefilled message", () => {
    const wa = channelOpenUrl({ kind: "WHATSAPP", value: "65988887777", url: null }, "Olá, tudo bem?");
    expect(wa).toBe("https://wa.me/5565988887777?text=Ol%C3%A1%2C%20tudo%20bem%3F");
    expect(channelOpenUrl({ kind: "EMAIL", value: "a@b.com", url: null }, "oi", "Assunto")).toBe("mailto:a@b.com?subject=Assunto&body=oi");
    expect(channelOpenUrl({ kind: "INSTAGRAM", value: "x", url: "https://www.instagram.com/x/" })).toBe("https://www.instagram.com/x/");
  });
});
