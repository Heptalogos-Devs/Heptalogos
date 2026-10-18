// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Historical admissions and completed Subject contacts; no current WorkContext inference.
 * @module native-calendar-read
 */
import {
  decodeProjection,
  decodeObservationInput,
  decodeAcceptedObservation,
  type HostPrepareRequest,
  type HostPrepareResponse,
  type HostAdmittedRequest,
} from "@nous-wave/client/host-bridge";
import type { PersistenceService } from "@heptalogos/persistence";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import type { NativeRunSnapshot } from "./native-cognition.js";

type Stamp = NonNullable<ReturnType<typeof decodeProjection>["semanticClock"]>;
const instant = (value: Stamp["at"]) =>
  value
    ? new Date(Number(value.seconds) * 1000 + value.nanos / 1e6).toISOString()
    : null;
const point = (value: Stamp | undefined) =>
  value?.at
    ? {
        timeDomainRef: value.timeDomainRef,
        at: instant(value.at)!,
        recordedAt: instant(value.recordedAt),
      }
    : null;
/** Reads only Host-owned immutable admissions with their original semantic and recording clocks. */
export async function readNativeCalendarWindow(
  persistence: PersistenceService,
  input: {
    subjectId: string;
    timeDomainRef: string;
    start: string;
    end: string;
    nearestCompleted?: boolean;
  },
) {
  const rows = await readRepositorySql<{
    run: NativeRunSnapshot;
    recorded_at: string;
    contact: {
      request: HostPrepareRequest;
      response: HostPrepareResponse;
      admitted: HostAdmittedRequest;
    };
    consumed: boolean;
  }>(
    persistence,
    `WITH matches AS (SELECT r.document AS run,c.document AS contact,c.recorded_at::text AS recorded_at,
    EXISTS(SELECT 1 FROM heptalogos.cognition_pending_feedback p WHERE p.subject_id=c.subject_id
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
        AND p.document#>>'{observation,context,native_session_id}'=c.document#>>'{request,native,sessionId}'))) AS consumed
    FROM heptalogos.life_native_contact c JOIN heptalogos.life_native_run r USING(run_id)
    WHERE c.subject_id=$1 AND c.document ? 'admitted' AND r.document->>'consumerId' IS NOT NULL
    AND ((c.document#>>'{admitted,projection,semanticClock,timeDomainRef}'=$2
      AND (c.document#>>'{admitted,projection,semanticClock,at}')::timestamptz >= $3::timestamptz
      AND (c.document#>>'{admitted,projection,semanticClock,at}')::timestamptz < $4::timestamptz)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.document#>'{response,contacts}') x
      WHERE COALESCE(x#>>'{observation,worldRealized,worldObserved,timeDomainRef}',x#>>'{observation,observedStamp,timeDomainRef}', 'time:real')=$2
      AND COALESCE(x#>>'{observation,worldRealized,worldObserved,at}',x#>>'{observation,observedStamp,at}',x#>>'{observation,observedAt}')::timestamptz >= $3::timestamptz
      AND COALESCE(x#>>'{observation,worldRealized,worldObserved,at}',x#>>'{observation,observedStamp,at}',x#>>'{observation,observedAt}')::timestamptz < $4::timestamptz))
    ) SELECT * FROM matches WHERE NOT $5::boolean OR (consumed
      AND contact#>>'{response,roleScope,role}'='subject.deliberation'
      AND contact#>>'{response,roleScope,view}'='subject'
      AND contact#>>'{admitted,projection,semanticClock,timeDomainRef}'=$2
      AND (contact#>>'{admitted,projection,semanticClock,at}')::timestamptz < $4::timestamptz)
    ORDER BY CASE WHEN $5::boolean THEN (contact#>>'{admitted,projection,semanticClock,at}')::timestamptz
      ELSE recorded_at::timestamptz END DESC,contact#>>'{request,contactRequestId}' DESC
    LIMIT CASE WHEN $5::boolean THEN 1 ELSE 129 END`,
    [
      input.subjectId,
      input.timeDomainRef,
      input.start,
      input.end,
      input.nearestCompleted ?? false,
    ],
  );
  const within = (value: ReturnType<typeof point>) =>
    !!value &&
    value.timeDomainRef === input.timeDomainRef &&
    Date.parse(value.at) >= Date.parse(input.start) &&
    Date.parse(value.at) < Date.parse(input.end);
  return {
    inputs: rows.slice(0, 128).flatMap((row) => {
      const projection = decodeProjection(row.contact.admitted.projection);
      if (
        projection.subjectId !== input.subjectId ||
        projection.consumerId !== row.run.consumerId
      )
        return [];
      const contextAt = point(projection.semanticClock);
      const contacts =
        row.consumed &&
        row.contact.response.roleScope.contactNature === "subject_experience" &&
        row.contact.response.roleScope.view === "subject"
          ? row.contact.admitted.occurrences.flatMap((entry) => {
              const contact = row.contact.response.contacts.find(
                (c) => c.contactRef === entry.contactRef,
              );
              if (!contact) return [];
              const observation = decodeObservationInput(contact.observation);
              const receipt = decodeAcceptedObservation(entry.receipt);
              if (observation.subjectId !== input.subjectId || !receipt.occurrenceId)
                return [];
              const observedAt =
                point(
                  observation.worldRealized?.worldObserved ?? observation.observedStamp,
                ) ??
                (observation.observedAt
                  ? {
                      timeDomainRef: "time:real",
                      at: instant(observation.observedAt)!,
                      recordedAt: null,
                    }
                  : null);
              if (!within(observedAt)) return [];
              return [
                {
                  contactRef: contact.contactRef,
                  occurrenceId: receipt.occurrenceId,
                  conversationRef: observation.conversationRef ?? null,
                  observedAt,
                  text:
                    observation.material.case === "inlineText"
                      ? observation.material.value.text
                      : null,
                },
              ];
            })
          : [];
      return [
        {
          runId: row.run.runId,
          activityId: row.run.registration.activityId,
          role: row.contact.response.roleScope.role,
          contextAt,
          contextInWindow: within(contextAt),
          recordedAt: row.recorded_at,
          consumed: row.consumed,
          contacts,
        },
      ];
    }),
    more: rows.length > 128,
  };
}
