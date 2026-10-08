/** Datas do SQLite vêm em UTC como "YYYY-MM-DD HH:MM:SS". */
export function formatDateTime(
  value: string | null | undefined,
): string {
  if (!value) return "—";

  const date = new Date(
    value.includes("T")
      ? value
      : value.replace(" ", "T") + "Z",
  );

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatCurrency(
  value: number | null | undefined,
): string {
  return (value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** (65) 99999-1234 / (65) 3333-1234 a partir de dígitos. */
export function formatPhone(digits: string | null | undefined): string {
  const d = (digits ?? "").replace(/\D/g, "");

  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

  return digits ?? "";
}

export function errorMessage(
  err: unknown,
  fallback: string,
): string {
  if (err instanceof Error) return err.message;

  if (typeof err === "string" && err) return err;

  // Erros do Supabase/PostgREST chegam como objeto { message }.
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }

  return fallback;
}
