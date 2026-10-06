import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * fetch sem CORS dentro do Tauri (plugin-http); fora do Tauri
 * (testes, vite dev no navegador) cai no fetch global.
 */
export function httpFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const inTauri =
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;

  return inTauri
    ? tauriFetch(input, init)
    : fetch(input, init);
}
