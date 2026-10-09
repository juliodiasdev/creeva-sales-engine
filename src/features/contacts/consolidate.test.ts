import { describe, expect, it } from "vitest";

import { consolidateChannels } from "./consolidate";
import type { StoredChannel } from "./channels.repository";

let id = 0;
const ch = (
  kind: StoredChannel["kind"],
  value: string,
  source = "WEBSITE",
  label: string | null = null,
): StoredChannel => ({ id: ++id, company_id: 1, kind, value, url: null, label, source });

describe("consolidateChannels", () => {
  it("junta WhatsApp e Telefone do mesmo número e mostra um contato por tipo", () => {
    const { main, extra } = consolidateChannels([
      ch("PHONE", "65992250342", "GOOGLE_PLACES"),
      ch("WHATSAPP", "65992250342", "GOOGLE_PLACES", "provável (celular)"),
      ch("WHATSAPP", "65992250342", "WEBSITE", "confirmado no site"),
      ch("PHONE", "17915393744"),
      ch("WHATSAPP", "17915393744", "WEBSITE", "provável (celular)"),
      ch("EMAIL", "a@x.com"),
      ch("EMAIL", "b@x.com"),
      ch("INSTAGRAM", "clinica"),
    ]);

    expect(main.map((c) => c.kind)).toEqual(["WHATSAPP", "EMAIL", "INSTAGRAM"]);
    expect(main[0].label).toBe("confirmado no site");
    expect(main.filter((c) => c.kind === "PHONE")).toHaveLength(0);
    expect(extra.map((c) => `${c.kind}:${c.value}`)).toEqual([
      "WHATSAPP:17915393744",
      "EMAIL:b@x.com",
    ]);
  });

  it("mantém o telefone fixo quando não há WhatsApp com o mesmo número", () => {
    const { main } = consolidateChannels([ch("PHONE", "6533331111", "GOOGLE_PLACES")]);

    expect(main).toHaveLength(1);
    expect(main[0].kind).toBe("PHONE");
  });
});
