import { getSupabase, unwrap } from "../../lib/store";

export interface Service {
  id: number;
  key: string;
  name: string;
  description: string;
  pain_points: string | null;
  active: number;
  sort: number;
}

export type ServiceKey =
  | "LANDING_PAGE"
  | "SITE_LOJA"
  | "SOFTWARE_APP"
  | "SISTEMA_AUTOMACAO"
  | "SUPORTE";

/** Catálogo inicial (editável em Settings). */
export const DEFAULT_SERVICES: Omit<Service, "id">[] = [
  {
    key: "LANDING_PAGE",
    name: "Landing pages",
    description:
      "Páginas para divulgar uma oferta, captar contatos e apoiar campanhas.",
    pain_points:
      "Anúncios que não convertem, visitantes que não viram contato, sem caminho claro até o agendamento/orçamento.",
    active: 1,
    sort: 1,
  },
  {
    key: "SITE_LOJA",
    name: "Sites e lojas virtuais",
    description:
      "Presença digital para apresentar a empresa e vender produtos.",
    pain_points:
      "Sem site, site fora do ar, sem HTTPS, não adaptado ao celular ou desatualizado.",
    active: 1,
    sort: 2,
  },
  {
    key: "SOFTWARE_APP",
    name: "Softwares e aplicativos",
    description:
      "Produtos digitais desenvolvidos conforme a necessidade do cliente.",
    pain_points:
      "Operação que não cabe em ferramentas prontas, processo próprio, necessidade de produto/aplicativo exclusivo.",
    active: 1,
    sort: 3,
  },
  {
    key: "SISTEMA_AUTOMACAO",
    name: "Sistemas e automações",
    description:
      "Gestão, painéis e automatização de tarefas repetitivas.",
    pain_points:
      "Agenda, cobrança, atendimento e relatórios feitos à mão; muito volume de clientes para controlar em planilha/WhatsApp.",
    active: 1,
    sort: 4,
  },
  {
    key: "SUPORTE",
    name: "Suporte contínuo",
    description:
      "Ajustes, atualizações e acompanhamento após a publicação.",
    pain_points:
      "Site/sistema parado no tempo, sem manutenção, sem quem resolva problemas e evolua o projeto.",
    active: 1,
    sort: 5,
  },
];

export async function ensureServicesSeed(): Promise<void> {
  const supabase = getSupabase();

  const { count, error } = await supabase
    .from("services")
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(error.message);

  if ((count ?? 0) > 0) return;

  unwrap(await supabase.from("services").insert(DEFAULT_SERVICES));
}

export async function listServices(
  onlyActive = false,
): Promise<Service[]> {
  let query = getSupabase()
    .from("services")
    .select("*")
    .order("sort", { ascending: true });

  if (onlyActive) query = query.eq("active", 1);

  return unwrap(await query) as Service[];
}

export async function updateService(
  id: number,
  fields: Partial<Pick<Service, "name" | "description" | "pain_points" | "active">>,
): Promise<void> {
  if (fields.name !== undefined && !fields.name.trim()) {
    throw new Error("O nome do serviço não pode ficar vazio.");
  }

  unwrap(
    await getSupabase().from("services").update(fields).eq("id", id),
  );
}
