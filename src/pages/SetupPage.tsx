import { useState } from "react";
import type { FormEvent } from "react";

import logo from "../assets/creava-logo.png";

import { saveConfig } from "../lib/supabase";

export function SetupPage({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const cleanUrl = url.trim().replace(/\/+$/, "");

    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cleanUrl)) {
      setError("A URL deve ser parecida com https://xxxx.supabase.co");
      return;
    }

    if (anonKey.trim().length < 20) {
      setError("Cole a chave anon/public do projeto.");
      return;
    }

    saveConfig({ url: cleanUrl, anonKey: anonKey.trim() });
    onDone();
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src={logo} alt="Creava" />

        <h1>Conectar ao banco</h1>

        <p className="muted">
          Primeira configuração deste computador. Use os dados do projeto
          Supabase (Project Settings → API).
        </p>

        <label>
          Project URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            autoFocus
          />
        </label>

        <label>
          Chave anon / public
          <input
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder="eyJ..."
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit">Conectar</button>
      </form>
    </main>
  );
}
