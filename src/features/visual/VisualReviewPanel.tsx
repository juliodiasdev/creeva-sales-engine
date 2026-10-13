import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../../lib/format";
import { fileToJpegDataUrl } from "../../lib/image";
import { openExternal } from "../../lib/opener";

import {
  VISUAL_CHECKLIST,
  VISUAL_TARGET_LABEL,
} from "./visual.checklist";
import type {
  SiteMetrics,
  VisualAnswer,
  VisualReview,
  VisualStatus,
  VisualTarget,
} from "./visual.checklist";
import {
  analyzeSiteWithGoogle,
  clearVisualReview,
  loadVisualOverview,
  MAX_IMAGES,
  saveVisualReview,
  suggestVisualAnswers,
} from "./visual.service";
import type { VisualOverview } from "./visual.service";

const STATUS_TEXT: Record<VisualStatus, string> = {
  OK: "Bom",
  WARN: "Atenção",
  FAIL: "Problema",
};

const STATUS_CLASS: Record<VisualStatus, string> = {
  OK: "ok",
  WARN: "partial",
  FAIL: "missing",
};

type Draft = Record<string, { status?: VisualStatus; note: string; ai?: boolean }>;

const toDraft = (answers: VisualAnswer[]): Draft =>
  Object.fromEntries(answers.map((a) => [a.id, { status: a.status, note: a.note ?? "" }]));

const HOW_TO: Record<VisualTarget, string> = {
  INSTAGRAM:
    "Abra o perfil, olhe o topo, o feed e os destaques e responda o checklist. Ou tire prints (perfil + feed + uma arte recente), cole aqui (Ctrl+V) ou escolha os arquivos: a IA sugere as respostas e você confere antes de salvar.",
  WHATSAPP:
    "Abra a conversa com a empresa no WhatsApp e toque no nome para ver o perfil comercial. Responda o checklist, ou envie prints do perfil e do catálogo para a IA sugerir (você confere antes de salvar).",
  SITE:
    "Meça com o Google (nota de desempenho no celular + captura da página) e deixe a IA sugerir a aparência. Ou abra o site, olhe o topo da página e responda à mão.",
};

function MetricsLine({ metrics }: { metrics: SiteMetrics }) {
  return (
    <p className="muted small">
      Google PageSpeed (celular): desempenho <strong>{metrics.performance ?? "—"}</strong> · acessibilidade{" "}
      {metrics.accessibility ?? "—"} · boas práticas {metrics.bestPractices ?? "—"} · SEO {metrics.seo ?? "—"}
      {metrics.lcpMs != null ? ` · conteúdo principal em ${(metrics.lcpMs / 1000).toFixed(1)} s` : ""} · medido em{" "}
      {formatDateTime(metrics.measuredAt)}
    </p>
  );
}

function TargetCard({
  companyId,
  target,
  link,
  review,
  onChanged,
}: {
  companyId: number;
  target: VisualTarget;
  link: string | null;
  review: VisualReview | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "ai" | "google" | "save">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const items = VISUAL_CHECKLIST[target];
  const answered = review?.answers.length ?? 0;

  function start() {
    setDraft(toDraft(review?.answers ?? []));
    setSummary(review?.summary ?? null);
    setImages([]);
    setShot(null);
    setError("");
    setNotice("");
    setOpen(true);
  }

  async function addFiles(files: File[]) {
    try {
      setError("");

      const room = MAX_IMAGES - images.length;

      if (room <= 0) throw new Error(`No máximo ${MAX_IMAGES} prints por análise.`);

      const urls = await Promise.all(files.slice(0, room).map((f) => fileToJpegDataUrl(f)));

      setImages((prev) => [...prev, ...urls]);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível usar a imagem."));
    }
  }

  function applySuggestion(answers: VisualAnswer[], text: string | null) {
    setDraft((prev) => {
      const next = { ...prev };

      for (const a of answers) {
        next[a.id] = { status: a.status, note: a.note ?? "", ai: true };
      }

      return next;
    });
    setSummary(text);
    setNotice("Sugestão da IA aplicada. Confira cada item antes de salvar: você decide.");
  }

  async function suggest() {
    try {
      setBusy("ai");
      setError("");
      setNotice("");

      const out = await suggestVisualAnswers(companyId, target, images);

      applySuggestion(out.answers, out.summary);
    } catch (err) {
      setError(errorMessage(err, "A IA não conseguiu analisar os prints."));
    } finally {
      setBusy("");
    }
  }

  async function measureSite() {
    try {
      setBusy("google");
      setError("");
      setNotice("");

      const out = await analyzeSiteWithGoogle(companyId);

      setShot(out.screenshot);
      onChanged();

      if (out.suggestion) {
        applySuggestion(out.suggestion.answers, out.suggestion.summary);
      } else {
        setNotice(
          out.suggestionError
            ? `Medição do Google salva. ${out.suggestionError}`
            : "Medição do Google salva. Sem captura da página para a IA: responda a aparência à mão.",
        );
      }
    } catch (err) {
      setError(errorMessage(err, "Não foi possível medir o site."));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    try {
      setBusy("save");
      setError("");

      const answers = Object.entries(draft)
        .filter(([, v]) => v.status)
        .map(([id, v]) => ({ id, status: v.status as VisualStatus, note: v.note }));

      await saveVisualReview(companyId, target, {
        answers,
        summary,
        source: Object.values(draft).some((d) => d.ai) ? "AI_ASSISTED" : "MANUAL",
      });

      setOpen(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível salvar a revisão."));
    } finally {
      setBusy("");
    }
  }

  async function clear() {
    try {
      setBusy("save");
      await clearVisualReview(companyId, target);
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível limpar a revisão."));
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="visual-card">
      <div className="visual-head">
        <div>
          <strong>{VISUAL_TARGET_LABEL[target]}</strong>
          <p className="muted small">
            {answered > 0
              ? `${answered} de ${items.length} itens revisados em ${formatDateTime(review!.reviewedAt)}${review!.source === "AI_ASSISTED" ? " (IA sugeriu, você conferiu)" : ""}`
              : "Ainda não revisado"}
          </p>
          {review?.summary && <p className="small">{review.summary}</p>}
          {review?.metrics && <MetricsLine metrics={review.metrics} />}
        </div>

        <div className="outreach-actions">
          {link && (
            <button type="button" className="secondary" onClick={() => void openExternal(link)}>
              Abrir {target === "SITE" ? "site" : target === "INSTAGRAM" ? "perfil" : "conversa"}
            </button>
          )}

          {!open && (
            <button type="button" onClick={start}>
              {answered > 0 ? "Refazer revisão" : "Revisar"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div
          className="visual-form"
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));

            if (files.length > 0) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
        >
          <p className="muted small">{HOW_TO[target]}</p>

          {target === "SITE" && (
            <div className="outreach-actions">
              <button type="button" disabled={busy !== ""} onClick={() => void measureSite()}>
                {busy === "google" ? "Medindo (pode levar até 1 minuto)…" : "Medir com Google + IA"}
              </button>
            </div>
          )}

          {shot && (
            <img className="visual-shot" src={shot} alt="Captura da página no celular, feita pelo Google" />
          )}

          <div className="visual-upload">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              className="secondary"
              disabled={busy !== "" || images.length >= MAX_IMAGES}
              onClick={() => fileInput.current?.click()}
            >
              Escolher prints ({images.length}/{MAX_IMAGES})
            </button>

            <button type="button" disabled={busy !== "" || images.length === 0} onClick={() => void suggest()}>
              {busy === "ai" ? "A IA está olhando…" : "Sugerir com IA"}
            </button>

            <span className="muted small">Ou cole um print aqui com Ctrl+V. Os prints não são guardados.</span>
          </div>

          {images.length > 0 && (
            <div className="visual-thumbs">
              {images.map((src, i) => (
                <div key={src.slice(-40) + i} className="visual-thumb">
                  <img src={src} alt={`Print ${i + 1}`} />
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remover print ${i + 1}`}
                    onClick={() => setImages((prev) => prev.filter((_, n) => n !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {notice && <p className="notice small">{notice}</p>}
          <ErrorMessage message={error} />

          <div className="visual-items">
            {items.map((item) => {
              const value = draft[item.id];

              return (
                <div key={item.id} className="visual-item">
                  <div>
                    <strong>{item.label}</strong>
                    <p className="muted small">{item.question}</p>
                  </div>

                  <div className="seg" role="group" aria-label={item.label}>
                    {(["OK", "WARN", "FAIL"] as VisualStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        title={item.hints[status]}
                        aria-pressed={value?.status === status}
                        className={value?.status === status ? `on seg-${STATUS_CLASS[status]}` : "secondary"}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            [item.id]: { note: d[item.id]?.note ?? "", status: d[item.id]?.status === status ? undefined : status },
                          }))
                        }
                      >
                        {STATUS_TEXT[status]}
                      </button>
                    ))}
                  </div>

                  <p className="muted small visual-hint">
                    {value?.status ? item.hints[value.status] : "Escolha uma opção (passe o mouse para ver o que cada uma significa)."}
                    {value?.ai ? " · sugerido pela IA" : ""}
                  </p>

                  <input
                    type="text"
                    maxLength={160}
                    placeholder="O que você viu (opcional)"
                    value={value?.note ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [item.id]: { ...d[item.id], note: e.target.value } }))
                    }
                  />
                </div>
              );
            })}
          </div>

          <div className="outreach-actions">
            <button
              type="button"
              disabled={busy !== "" || !Object.values(draft).some((d) => d.status)}
              onClick={() => void save()}
            >
              {busy === "save" ? "Salvando…" : "Salvar revisão"}
            </button>

            <button type="button" className="secondary" disabled={busy !== ""} onClick={() => setOpen(false)}>
              Cancelar
            </button>

            {answered > 0 && (
              <button type="button" className="secondary" disabled={busy !== ""} onClick={() => void clear()}>
                Apagar revisão
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * Revisão visual: o que o app não lê sozinho (Instagram, WhatsApp Business e a
 * aparência do site). O vendedor responde o checklist, ou a IA sugere a partir
 * de prints e o vendedor confere. Cada resposta alimenta a presença digital.
 */
export function VisualReviewPanel({
  companyId,
  onChanged,
}: {
  companyId: number;
  onChanged?: () => void;
}) {
  const [overview, setOverview] = useState<VisualOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await loadVisualOverview(companyId));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a revisão visual."));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview) return <ErrorMessage message={error} />;

  return (
    <div className="ficha-group">
      <h3 className="group-title">Revisão visual: banners, Instagram, WhatsApp e site</h3>
      <p className="muted small">
        O app não consegue ler Instagram nem WhatsApp sozinho. Aqui você confere se os banners estão
        velhos ou faltando, se o perfil está completo e se o site parece atual: é aí que o design da
        Creava entra como solução.
      </p>

      <ErrorMessage message={error} />

      {overview.targets.length === 0 ? (
        <p className="muted">
          Nenhum Instagram, WhatsApp ou site encontrado para revisar. Enriqueça a empresa primeiro.
        </p>
      ) : (
        overview.targets.map((t) => (
          <TargetCard
            key={t.target}
            companyId={companyId}
            target={t.target}
            link={t.link}
            review={t.review}
            onChanged={() => {
              void load();
              onChanged?.();
            }}
          />
        ))
      )}
    </div>
  );
}
