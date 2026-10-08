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
