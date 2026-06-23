import { Fragments, Contours, Misses, Rel, now } from '../db/repo';
import { TUNING } from '../config';
import type { Fragment, MissType } from '../types';
import type { StrikeOut } from '../llm/schemas';
import type { ScoreResult } from './scoring';
import { materialWeight } from './scoring';

/** ユーザー回答を内面モデルに取り込む：domain の contour に素材を積む。 */
export function ingestAnswer(uid: string, answerTurnId: string, score: ScoreResult): { contourId: string; domain: string } {
  const contour = Contours.forDomain(uid, score.domain);
  Contours.bump(contour.id, materialWeight(score.scores));

  // known_domains を更新
  const rel = Rel.get(uid);
  if (!rel.known_domains.includes(score.domain)) {
    rel.known_domains.push(score.domain);
    Rel.save(rel);
  }
  return { contourId: contour.id, domain: score.domain };
}

/** strike をプロフ未確定(proposed)の Fragment として保存。 */
export function saveStrike(uid: string, s: StrikeOut, evidenceTurnIds: string[], contourId: string): Fragment {
  const halfLife = TUNING.HALFLIFE_DAYS[s.type] ?? null;
  return Fragments.add({
    user_id: uid,
    text: s.message,
    type: s.type,
    domain: s.domain,
    components: s.components as any,
    confidence: s.confidence,
    status: 'proposed',
    evidence: evidenceTurnIds,
    contour_id: contourId,
    recency: { lastConfirmedAt: null, halfLifeDays: halfLife ?? 0 },
    reask: halfLife ? { lastAskedAt: null, nextEligibleAt: null, version: 1, history: [] } : null,
  });
}

/** 反応を適用（spec 4-D / engine_design §1-7）。どの反応でもデータは捨てない。 */
export function applyReaction(fragmentId: string, kind: 'agree' | 'unsure' | 'disagree') {
  const f = Fragments.get(fragmentId); if (!f) return;
  const reactions = [...f.reactions, { type: kind, at: now() }];
  if (kind === 'agree') {
    Fragments.update(fragmentId, {
      status: 'agreed', confidence: Math.max(f.confidence, 0.75), reactions,
      recency: { lastConfirmedAt: now(), halfLifeDays: f.recency?.halfLifeDays ?? 0 },
    });
    if (f.contour_id) Contours.markStruck(f.contour_id);
  } else if (kind === 'unsure') {
    Fragments.update(fragmentId, { status: 'unsure', confidence: 0.4, reactions });
    if (f.contour_id) Contours.markStruck(f.contour_id);
  } else {
    // disagree: status は proposed のまま、反応だけ記録。次に miss 型で掘る。
    Fragments.update(fragmentId, { confidence: 0.15, reactions });
    if (f.contour_id) Contours.markStruck(f.contour_id);
  }
}

/** ハズレ型を適用（engine_design §1-3 の対応表）。 */
export function applyMiss(fragmentId: string, type: MissType, detail?: string) {
  const f = Fragments.get(fragmentId); if (!f) return;
  Misses.add({ fragment_id: fragmentId, type, detail: detail ?? null });

  const comp = { ...f.components };
  switch (type) {
    case 'opposite':
      comp.valence = comp.valence === 'pos' ? 'neg' : comp.valence === 'neg' ? 'pos' : 'neu';
      Fragments.update(fragmentId, { components: comp, status: 'retired' });
      break;
    case 'reason':
      // 「何」は保持（agreed相当）、「なぜ」を開け直す
      Fragments.update(fragmentId, { status: 'corrected', confidence: 0.6 });
      break;
    case 'partial':
      Fragments.update(fragmentId, { status: 'corrected', confidence: 0.55 });
      break;
    case 'degree':
    case 'object':
      Fragments.update(fragmentId, { status: 'retired' });
      break;
    case 'whole':
      Fragments.update(fragmentId, { status: 'retired' });
      break;
    case 'custom':
      Fragments.update(fragmentId, { status: 'retired' });
      break;
  }
}

/** corrected/agreed な再strikeを保存。 */
export function saveCorrectedStrike(uid: string, s: StrikeOut, evidence: string[], contourId: string, originalMissFragId: string): Fragment {
  const frag = Fragments.add({
    user_id: uid, text: s.message, type: s.type, domain: s.domain,
    components: s.components as any, confidence: s.confidence, status: 'proposed',
    evidence, contour_id: contourId,
  });
  return frag;
}
