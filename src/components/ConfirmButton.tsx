import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Ação que exige aceite explícito (usa créditos, rede ou dados do site):
 * o 1º clique pede confirmação, o 2º executa.
 */
export function ConfirmButton({
  children,
  warning,
  confirmLabel = "Confirmar",
  disabled,
  secondary,
  onConfirm,
}: {
  children: ReactNode;
  warning: string;
  confirmLabel?: string;
  disabled?: boolean;
  secondary?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        className={secondary ? "secondary" : undefined}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {children}
      </button>
    );
  }

  return (
    <span className="confirm-inline">
      <span className="muted">{warning}</span>

      <button
        type="button"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>

      <button
        type="button"
        className="secondary"
        onClick={() => setAsking(false)}
      >
        Cancelar
      </button>
    </span>
  );
}
