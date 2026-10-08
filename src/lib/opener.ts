const ALLOWED = /^(https?:|mailto:|tel:)/i;

/**
 * Abre um link no app padrão do sistema (navegador, WhatsApp, e-mail,
 * discador). Só aceita esquemas conhecidos.
 */
export async function openExternal(url: string): Promise<void> {
  if (!ALLOWED.test(url)) {
    throw new Error("Link não permitido.");
  }

  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");

    await openUrl(url);
  } catch {
    // Fora do Tauri (navegador/dev): abre numa nova aba.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
