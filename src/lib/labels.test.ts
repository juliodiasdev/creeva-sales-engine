import { describe, expect, it } from "vitest";

import {
  JOB_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  LOST_REASON_LABEL,
  SIGNAL_LABEL,
  TASK_TYPE_LABEL,
  humanizeReason,
} from "./labels";
import { LOST_REASONS } from "../features/deals/deal.types";
import { PLAYBOOK_KINDS } from "../features/playbook/playbook.service";
import { PLAYBOOK_KIND_LABEL } from "./labels";

describe("labels", () => {
  it("cover every enum the UI can show", () => {
    for (const r of LOST_REASONS) expect(LOST_REASON_LABEL[r], r).toBeTruthy();
    for (const k of PLAYBOOK_KINDS) expect(PLAYBOOK_KIND_LABEL[k], k).toBeTruthy();
    for (const t of ["FIRST_CONTACT", "FOLLOW_UP", "CALL", "MEETING", "PROPOSAL", "OTHER"]) expect(TASK_TYPE_LABEL[t]).toBeTruthy();
    for (const s of ["DISCOVERED", "ENRICHING", "QUALIFIED", "READY", "DISQUALIFIED"]) expect(LEAD_STATUS_LABEL[s]).toBeTruthy();
    for (const s of ["PENDING", "RUNNING", "COMPLETED", "FAILED"]) expect(JOB_STATUS_LABEL[s]).toBeTruthy();
    for (const s of ["NO_WEBSITE", "NO_HTTPS", "NO_WHATSAPP", "NO_CLEAR_CTA", "NO_FORM", "OUTDATED_COPYRIGHT", "LOW_REVIEWS", "BROKEN_LINK", "WEAK_CONVERSION_PATH", "NO_MOBILE_SIGNAL"]) expect(SIGNAL_LABEL[s]).toBeTruthy();
  });

  it("humanizes score reasons and leaves free text alone", () => {
    expect(humanizeReason("NO_WEBSITE: Nenhum website")).toBe("Sem site: Nenhum website");
    expect(humanizeReason("Segmento informado: X")).toBe("Segmento informado: X");
  });
});
