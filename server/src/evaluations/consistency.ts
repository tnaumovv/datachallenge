import type { ChecklistVersion, Conversation } from '../../../shared/contracts.js';
import type { CandidateOutput } from '../../../shared/evaluation-policy.js';
import { defaultChecklist } from '../checklists/default.js';
import { criterionFingerprint } from '../checklists/profiles.js';
/** Only apply shipped semantic rules to the exact shipped definition. Model events remain claims. */
export function consistencyReasons(
  output: CandidateOutput,
  conversation: Conversation,
  checklist: ChecklistVersion,
): string[] {
  const reasons: string[] = [];
  const standard = (id: string) => {
    const a = checklist.criteria.find((c) => c.id === id),
      b = defaultChecklist.criteria.find((c) => c.id === id);
    return !!a && !!b && criterionFingerprint(a) === criterionFingerprint(b);
  };
  const observed = (name: string) =>
    output.observations
      .filter((o) => o.name === name && o.status === 'observed')
      .flatMap((o) => o.messageIds);
  const index = (id: string) => conversation.messages.findIndex((m) => m.id === id);
  if (
    observed('operator_action').some(
      (id) => conversation.messages[index(id)]?.speaker !== 'operator',
    )
  )
    reasons.push('observation_role_conflict');
  const verified = observed('identity_verified'),
    disclosed = observed('protected_disclosure');
  const identity = output.assessments.find(
    (a) => a.status === 'resolved' && a.answer.criterionId === 'identity',
  );
  if (
    standard('identity') &&
    identity?.status === 'resolved' &&
    identity.answer.value === true &&
    disclosed.length &&
    verified.length &&
    Math.min(...disclosed.map(index)) < Math.min(...verified.map(index))
  )
    reasons.push('disclosure_before_identity');
  if (output.observations.some((o) => o.status === 'unknown')) reasons.push('unknown_observation');
  return reasons;
}
