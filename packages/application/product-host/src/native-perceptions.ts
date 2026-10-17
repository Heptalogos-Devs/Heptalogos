// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads durable provider-admitted Task perception references, never cognition text or new observations.
 * @module native-perceptions
 */
import {
  decodeAcceptedObservation,
  decodeObservationInput,
  decodeProjection,
  type HostAdmittedRequest,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  readRepositorySql,
  executeRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { createLifeService } from "@heptalogos/subject";
import type { NativeRunSnapshot } from "./native-cognition.js";
/** Only official receipt/reference types cross the actual perception boundary. */
export interface TaskPerceptions {
  readonly sourceRefs: string[];
  readonly accepted: HostAdmittedRequest["occurrences"];
  /** Historical candidates only; never put these IDs in sourceRead without exact owner lineage. */
  readonly selectionCandidates: string[];
}
/** These references are discovered from Host admissions, never from Activity notes or model proposals. */
export function createTaskPerceptionReader(options: {
  persistence: PersistenceService;
  life: Pick<ReturnType<typeof createLifeService>, "get">;
}) {
  return async (
    input: {
      subjectId: string;
      activityId: string;
      workContextId: string;
      conversationRef?: string;
      sourceRefs?: readonly string[];
    },
    transaction?: PersistenceInternalTransaction,
  ): Promise<TaskPerceptions> => {
    const result: TaskPerceptions = {
      sourceRefs: [],
      accepted: [],
      selectionCandidates: [],
    };
    const activity = await options.life.get(
      input.subjectId,
      input.activityId,
      transaction,
    );
    if (
      !activity?.scope ||
      !activity.adoptedBy ||
      activity.state !== "active" ||
      activity.workContextId !== input.workContextId
    )
      return result;
    const roots = activity.sourceRefs.filter(
      (ref) =>
        activity.scope!.sourceRefs.includes(ref) &&
        (!input.sourceRefs || input.sourceRefs.includes(ref)),
    );
    if (!roots.length) return result;
    const audience = input.conversationRef;
    if (
      audience &&
      !activity.scope.conversations.some(
        (grant) =>
          grant.conversationRef === audience && grant.operations.includes("observe"),
      )
    )
      return result;
    const statement = `SELECT c.document AS contact,r.document AS run FROM heptalogos.life_native_contact c JOIN heptalogos.life_native_run r ON r.run_id=c.run_id
      WHERE r.subject_id=$1 AND r.activity_id=$2 AND r.document#>>'{registration,workContextId}'=$3
      AND r.document->>'consumerId' IS NOT NULL AND c.document ? 'admitted'
      AND c.document#>>'{response,roleScope,contactNature}'='subject_experience'
      AND c.document#>>'{response,roleScope,view}'='subject'
      AND c.document#>>'{response,roleScope,role}'='subject.deliberation'
      AND c.document#>>'{response,roleScope,purpose}'='subject_deliberation'
      AND EXISTS (SELECT 1 FROM heptalogos.cognition_pending_feedback p WHERE p.subject_id=c.subject_id
        AND p.document#>>'{identity,contactRequestId}'=c.contact_request_id::text
        AND p.document#>>'{identity,invocationId}'=c.invocation_id
        AND p.document#>>'{identity,nousSessionId}'=c.document#>>'{request,nousSessionId}'
        AND p.document#>'{identity,native}'=c.document#>'{request,native}'
        AND ((p.document#>>'{observation,sourceClass}'='host_event'
          AND p.document#>>'{observation,context,outcome}'='completed'
          AND p.document#>>'{observation,context,invocation_id}'=c.invocation_id
          AND p.document#>>'{observation,context,projection_id}'=c.document#>>'{admitted,projection,projectionId}')
        OR (p.document#>>'{observation,sourceClass}'='generated'
          AND p.document#>>'{observation,context,role}'='assistant'
          AND p.document#>>'{observation,context,delivery}'='model_output'
          AND p.document#>>'{observation,context,native_run_id}'=c.run_id
          AND p.document#>>'{observation,context,native_session_id}'=c.document#>>'{request,native,sessionId}')))
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.document#>'{response,contacts}') x WHERE x->>'contactRef'=ANY($4::text[]) OR x#>>'{observation,context,message_ref}'=ANY($4::text[]))
      ORDER BY c.recorded_at DESC,c.contact_request_id DESC LIMIT 128`;
    type Row = {
      run: NativeRunSnapshot;
      contact: {
        request: { subjectId: string };
        response: HostPrepareResponse;
        admitted: HostAdmittedRequest;
      };
    };
    const parameters = [input.subjectId, input.activityId, input.workContextId, roots];
    const rows = transaction
      ? await executeRepositorySql<Row>(transaction, statement, parameters)
      : await readRepositorySql<Row>(options.persistence, statement, parameters);
    const occurrences = new Set<string>();
    for (const row of rows) {
      const projection = decodeProjection(row.contact.admitted.projection);
      if (
        projection.subjectId !== input.subjectId ||
        projection.consumerId !== row.run.consumerId
      )
        continue;
      let retained = false;
      for (const entry of row.contact.admitted.occurrences) {
        const contact = row.contact.response.contacts.find(
          (value) => value.contactRef === entry.contactRef,
        );
        if (!contact) continue;
        const observation = decodeObservationInput(contact.observation);
        const root = contact.contactRef.startsWith("attachment:")
          ? observation.context?.message_ref
          : contact.contactRef;
        if (
          typeof root !== "string" ||
          !roots.includes(root) ||
          observation.subjectId !== input.subjectId ||
          (audience && observation.conversationRef !== audience)
        )
          continue;
        if (
          observation.conversationRef &&
          !activity.scope.conversations.some(
            (grant) =>
              grant.conversationRef === observation.conversationRef &&
              grant.operations.includes("observe"),
          )
        )
          continue;
        const receipt = decodeAcceptedObservation(entry.receipt);
        if (!receipt.occurrenceId) continue;
        if (!occurrences.has(receipt.occurrenceId) && result.accepted.length < 128) {
          result.accepted.push(entry);
          occurrences.add(receipt.occurrenceId);
        }
        if (!result.sourceRefs.includes(root)) result.sourceRefs.push(root);
        retained = true;
      }
      if (retained) {
        for (const ref of projection.segments.flatMap(
          (segment) => segment.sourceRefs,
        )) {
          if (
            ref.kind === "derived_representation" &&
            !result.selectionCandidates.includes(ref.value) &&
            result.selectionCandidates.length < 128
          )
            result.selectionCandidates.push(ref.value);
        }
      }
    }
    return result;
  };
}
