import { useState } from "react";
import type { FormEvent } from "react";

import logo from "../assets/creava-logo.png";

import { signIn } from "../lib/auth";
import { clearConfig, loadConfig } from "../lib/supabase";
import { errorMessage } from "../lib/format";

export function LoginPage({
  onReconfigure,
}: {
  onReconfigure: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await signIn(email, password);
      // O App reage ao evento de autenticação.
    } catch (err) {
      setError(errorMessage(err, "Não foi possível entrar."));
    } finally {
      setLoading(false);
    }
  }

  // Configuração embutida no build não pode ser trocada pela tela.
  const canReconfigure = !import.meta.env?.VITE_SUPABASE_URL;

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <img className="auth-logo" src={logo} alt="Creava" />

        <div className="auth-brand">
          <strong>CREAVA</strong>
          <span className="eyebrow">DIGITAL · AGÊNCIA</span>
        </div>

        <label>
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </button>

        {canReconfigure && loadConfig() && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              clearConfig();
              onReconfigure();
            }}
          >
            Trocar banco de dados
          </button>
        )}
      </form>
    </main>
  );
}
