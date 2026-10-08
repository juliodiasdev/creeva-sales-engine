const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SaveFilter {
  name: string;
  extensions: string[];
}

/**
 * Salva um arquivo: no app desktop abre a janela "Salvar como…" do
 * Windows (e grava no local escolhido); no navegador usa um download.
 * Retorna o caminho salvo, ou null se o usuário cancelou.
 */
export async function saveFile(
  defaultName: string,
  data: Uint8Array,
  filters: SaveFilter[],
  mime = "application/octet-stream",
): Promise<string | null> {
  if (inTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");

    const path = await save({ defaultPath: defaultName, filters });

    if (!path) return null;

    await writeFile(path, data);

    return path;
  }

  const blob = new Blob([data as BlobPart], { type: mime });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = defaultName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);

  return defaultName;
}

export const saveText = (
  defaultName: string,
  text: string,
  filters: SaveFilter[],
  mime: string,
) => saveFile(defaultName, new TextEncoder().encode(text), filters, mime);
