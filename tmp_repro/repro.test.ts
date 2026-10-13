import { it } from "vitest";
import { matchServices } from "../src/features/services/offers.engine";
import { buildTemplateApproaches } from "../src/features/contacts/approaches.engine";

it("repro", () => {
  const company = { segment: "Odontologia", website: "https://x.com.br", reviews_count: 150, rating: 4.8, company_size: null, capital: null } as never;
  const facts = { technologies: [], error: null } as never;
  const m = matchServices({ company, signals: [], facts });
  console.log(JSON.stringify(m));
  const a = buildTemplateApproaches({ companyName: "Clínica X", segment: "Odontologia", matches: m, availableChannels: ["WHATSAPP","PHONE","LINKEDIN","EMAIL","INSTAGRAM"], agency: "Creava Digital", seller: "" });
  for (const x of a) console.log("----", x.channel, "\n" + x.message);
  const b = buildTemplateApproaches({ companyName: "Clínica X", segment: "Odontologia", matches: [], availableChannels: ["WHATSAPP"], agency: "Creava Digital", seller: "Júlio" });
  console.log("EMPTY MATCHES:\n" + b[0].message);
});
