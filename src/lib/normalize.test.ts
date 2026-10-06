import { describe, expect, it } from "vitest";

import {
  buildDedupeKey,
  normalizeCnpj,
  normalizeDomain,
  normalizePhone,
} from "./normalize";

describe("normalize", () => {
  it("domain", () => {
    expect(normalizeDomain("https://www.Exemplo.com.br/contato?x=1")).toBe("exemplo.com.br");
    expect(normalizeDomain("exemplo.com")).toBe("exemplo.com");
    expect(normalizeDomain("lixo")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });

  it("phone", () => {
    expect(normalizePhone("+55 (65) 99999-1234")).toBe("65999991234");
    expect(normalizePhone("(65) 3333-1234")).toBe("6533331234");
    expect(normalizePhone("1234")).toBeNull();
  });

  it("cnpj", () => {
    expect(normalizeCnpj("12.345.678/0001-95")).toBe("12345678000195");
    expect(normalizeCnpj("123")).toBeNull();
  });

  it("dedupe key ignores accents and punctuation", () => {
    expect(buildDedupeKey("Clínica  Ômega!", "Av. Brasil, 10")).toBe(
      buildDedupeKey("clinica omega", "av brasil 10"),
    );
    expect(buildDedupeKey("X", null, null)).toBeNull();
  });
});
