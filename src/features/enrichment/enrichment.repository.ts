import { getDatabase } from "../../lib/database";

import type { Signal } from "../signals/signals.engine";
import type { ScoreResult } from "../scoring/scoring.engine";
import type { WebsiteFacts } from "./website.facts";

export interface StoredSignal extends Signal {
  id: number;
  company_id: number;
  created_at: string;
}

export interface StoredScore {
  id: number;
  company_id: number;
  fit: number;
  need: number;
  capacity: number;
  intent: number;
  total: number;
  confidence: number;
  reasons: string;
  created_at: string;
}

export async function saveSnapshotRepository(
  companyId: number,
  facts: WebsiteFacts,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `INSERT INTO website_snapshots (company_id, url, facts) VALUES ($1,$2,$3)`,
    [companyId, facts.url, JSON.stringify(facts)],
  );
}

export async function getLatestSnapshotRepository(
  companyId: number,
): Promise<WebsiteFacts | null> {
  const db = await getDatabase();

  const rows = await db.select<{ facts: string }[]>(
    `SELECT facts FROM website_snapshots WHERE company_id = $1 ORDER BY id DESC LIMIT 1`,
    [companyId],
  );

  return rows[0] ? (JSON.parse(rows[0].facts) as WebsiteFacts) : null;
}

/** Substitui os signals da empresa pelos recém-derivados. */
export async function replaceSignalsRepository(
  companyId: number,
  signals: Signal[],
): Promise<void> {
  const db = await getDatabase();

  await db.execute(`DELETE FROM signals WHERE company_id = $1`, [companyId]);

  for (const s of signals) {
    await db.execute(
      `
        INSERT INTO signals (company_id, type, value, evidence, source, confidence)
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [companyId, s.type, s.value, s.evidence, s.source, s.confidence],
    );
  }
}

export async function listSignalsRepository(
  companyId: number,
): Promise<StoredSignal[]> {
  const db = await getDatabase();

  return db.select<StoredSignal[]>(
    `SELECT * FROM signals WHERE company_id = $1 ORDER BY id`,
    [companyId],
  );
}

export async function saveScoreRepository(
  companyId: number,
  score: ScoreResult,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO company_scores
        (company_id, fit, need, capacity, intent, total, confidence, reasons)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      companyId,
      score.fit,
      score.need,
      score.capacity,
      score.intent,
      score.total,
      score.confidence,
      JSON.stringify(score.reasons),
    ],
  );

  // Mantém o prospect (se existir) com o score mais recente.
  await db.execute(
    `
      UPDATE prospects
      SET score = $2,
          priority = CASE WHEN $2 >= 75 THEN 'HIGH' ELSE priority END,
          updated_at = datetime('now')
      WHERE company_id = $1
    `,
    [companyId, score.total],
  );
}

export async function getLatestScoreRepository(
  companyId: number,
): Promise<StoredScore | null> {
  const db = await getDatabase();

  const rows = await db.select<StoredScore[]>(
    `SELECT * FROM company_scores WHERE company_id = $1 ORDER BY id DESC LIMIT 1`,
    [companyId],
  );

  return rows[0] ?? null;
}
