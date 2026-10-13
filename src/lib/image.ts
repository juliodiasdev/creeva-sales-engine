const MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Reduz um print para caber na análise da IA (lado maior ≤ maxSide, JPEG) e
 * devolve um data URL. A imagem original nunca é guardada: só o resultado
 * da análise fica salvo.
 */
export async function fileToJpegDataUrl(
  file: File,
  maxSide = 1280,
  quality = 0.82,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Escolha um arquivo de imagem (JPG, PNG ou WebP).");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("A imagem é grande demais (máx. 15 MB).");
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Não foi possível ler esta imagem.");
  }

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Não foi possível processar a imagem.");

  // Fundo branco: PNG com transparência não pode virar preto no JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", quality);
}
