/** Helpers de normalização usados na deduplicação. */

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(
  value: string | null | undefined,
): string {
  return stripAccents(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Domínio sem protocolo, "www." nem caminho. Null se inválido. */
export function normalizeDomain(
  url: string | null | undefined,
): string | null {
  const raw = url?.trim();

  if (!raw) return null;

  try {
    const host = new URL(
      /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`,
    ).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Telefone BR só com dígitos, sem DDI 55. Null se curto demais. */
export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");

  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/^0+/, "");

  return digits.length >= 10 && digits.length <= 11
    ? digits
    : null;
}

export function normalizeCnpj(
  cnpj: string | null | undefined,
): string | null {
  const digits = (cnpj ?? "").replace(/\D/g, "");

  return digits.length === 14 ? digits : null;
}

/** Chave nome + endereço (ou cidade quando não há endereço). */
export function buildDedupeKey(
  name: string,
  address?: string | null,
  city?: string | null,
): string | null {
  const n = normalizeText(name);
  const place = normalizeText(address || city);

  return n && place ? `${n}|${place}` : null;
}
