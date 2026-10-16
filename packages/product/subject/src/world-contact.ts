// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Owns exclusive world occurrence handoff and actual admitted receipt adoption.
 * @module world-contact
 */
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  acknowledgeWorldContactSchema,
  type RealizedWorldEvent,
  type WorldState,
} from "./world-contracts.js";
import { subjectProblem } from "./problems.js";
function conflict(detail: string): never {
  throw subjectProblem(
    "world.conflict",
    "World handoff is unavailable",
    detail,
    "conflict",
  );
}
function checked<T>(schema: Parameters<typeof compileSchema<T>>[0], value: unknown): T {
  const result = compileSchema<T>(schema).validate(value);
  if (!result.ok) conflict("Use the exact world contact contract");
  return result.value;
}
/** Existing WorldLife passes its canonical readers and shared Subject lock; no separate runtime exists. */
export function createWorldContactService(options: {
  persistence: PersistenceService;
  now: () => string;
  readState: (subjectId: string, worldId: string) => Promise<WorldState | undefined>;
  readIn: (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    worldId: string,
  ) => Promise<WorldState | undefined>;
  lockSubject: (tx: PersistenceInternalTransaction, subjectId: string) => Promise<void>;
}) {
  const pendingContacts = async (
    subjectId: string,
    worldId: string,
    limit = 64,
    afterEventId?: string,
    exactEventId?: string,
  ) => {
    const state = await options.readState(subjectId, worldId);
    if (!state) conflict("World does not exist");
    const rows = await readRepositorySql<{
      document: RealizedWorldEvent;
      selected_run_id: string | null;
    }>(
      options.persistence,
      `SELECT e.document,r.selected_run_id FROM heptalogos.world_event e LEFT JOIN heptalogos.world_contact_release r USING(subject_id,world_id,event_id)
WHERE e.subject_id=$1 AND e.world_id=$2 AND (r.event_id IS NULL OR r.state='selected') AND ($6::uuid IS NULL OR e.event_id=$6) AND ($5::uuid IS NULL OR (e.recorded_at,e.event_id)>(SELECT recorded_at,event_id FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND event_id=$5)) AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.document->'perceptions') p WHERE p->>'actorRef'=$3) ORDER BY e.recorded_at,e.event_id LIMIT $4`,
      [
        subjectId,
        worldId,
        state.definition.subjectActorRef,
        Math.max(1, Math.min(limit, 128)),
        afterEventId ?? null,
        exactEventId ?? null,
      ],
    );
    return rows.map((row) => ({
      sourceRef: `world-event:${worldId}:${row.document.eventId}:${row.document.revision}`,
      selectedRunId: row.selected_run_id,
      eventId: row.document.eventId,
      eventRevision: row.document.revision,
      worldId,
      interval: row.document.interval,
      recordedAt: row.document.recordedAt,
      source: row.document.source,
      perceptions: row.document.perceptions.filter(
        (p) => p.actorRef === state.definition.subjectActorRef,
      ),
    }));
  };
  return {
    /** Filters recent visible state against actual accepted releases in one owner read. */
    async releasedEventIds(
      subjectId: string,
      worldId: string,
      eventIds: readonly string[],
      transaction?: PersistenceInternalTransaction,
    ) {
      if (eventIds.length > 128)
        conflict("Release lookups are bounded to the current 128-event view");
      const read = <T>(statement: string, parameters: readonly unknown[]) =>
        transaction
          ? executeRepositorySql<T>(transaction, statement, parameters)
          : readRepositorySql<T>(options.persistence, statement, parameters);
      const rows = await read<{ event_id: string }>(
        "SELECT event_id FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=ANY($3::uuid[]) AND state='released'",
        [subjectId, worldId, eventIds],
      );
      return rows.map((row) => row.event_id);
    },
    /** Retries only contact handoff, never realization or external effects. */
    pendingContacts,
    /** Reads one exact still-pending event without scanning a bounded earlier page. */
    async pendingContact(input: {
      subjectId: string;
      worldId: string;
      eventId: string;
    }) {
      return (
        await pendingContacts(
          input.subjectId,
          input.worldId,
          1,
          undefined,
          input.eventId,
        )
      )[0];
    },
    /** Atomically assigns one event occurrence to one stable subjective run, without claiming perception. */
    async selectContact(input: {
      subjectId: string;
      worldId: string;
      eventId: string;
      runId: string;
    }) {
      if (!input.runId.trim())
        conflict("Use the stable actual subjective run identity");
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await options.lockSubject(tx, input.subjectId);
          const state = await options.readIn(tx, input.subjectId, input.worldId);
          const events = await executeRepositorySql<{ document: RealizedWorldEvent }>(
            tx,
            "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
            [input.subjectId, input.worldId, input.eventId],
          );
          const event = events[0]?.document;
          if (
            !state ||
            !event?.perceptions.some(
              (p) => p.actorRef === state.definition.subjectActorRef,
            )
          )
            conflict("Only a realized Subject-visible event can be selected");
          const contactRef = `world-event:${input.worldId}:${event.eventId}:${event.revision}`;
          await executeRepositorySql(
            tx,
            `INSERT INTO heptalogos.world_contact_release(subject_id,world_id,event_id,contact_ref,recorded_at,state,selected_run_id)
           VALUES($1,$2,$3,$4,$5,'selected',$6) ON CONFLICT DO NOTHING`,
            [
              input.subjectId,
              input.worldId,
              input.eventId,
              contactRef,
              options.now(),
              input.runId,
            ],
          );
          const rows = await executeRepositorySql<{
            state: "selected" | "released";
            selected_run_id: string | null;
            contact_ref: string;
          }>(
            tx,
            "SELECT state,selected_run_id,contact_ref FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
            [input.subjectId, input.worldId, input.eventId],
          );
          const selected = rows[0]!;
          return {
            selected:
              selected.selected_run_id === input.runId &&
              selected.contact_ref === contactRef,
            selectedRunId: selected.selected_run_id,
            state: selected.state,
            contactRef: selected.contact_ref,
          };
        }),
      );
    },
    /** Trusted Reactor proves the old run never prepared/published; an admitted or uncertain publication is never reassigned. */
    async reassignSelectedContactIn(
      tx: PersistenceInternalTransaction,
      input: {
        subjectId: string;
        worldId: string;
        eventId: string;
        expectedRunId: string;
        newRunId: string;
        basisRef: string;
      },
    ) {
      if (
        !input.expectedRunId.trim() ||
        !input.newRunId.trim() ||
        !input.basisRef.trim()
      )
        conflict(
          "A selection reassignment needs exact actual run identities and its revoked unpublished basis",
        );
      await options.lockSubject(tx, input.subjectId);
      const rows = await executeRepositorySql<{
        selected_run_id: string | null;
        state: string;
      }>(
        tx,
        "SELECT selected_run_id,state FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=$3 FOR UPDATE",
        [input.subjectId, input.worldId, input.eventId],
      );
      if (
        rows[0]?.state !== "selected" ||
        rows[0].selected_run_id !== input.expectedRunId
      )
        return false;
      if (input.expectedRunId === input.newRunId) return true;
      await executeRepositorySql(
        tx,
        "UPDATE heptalogos.world_contact_release SET selected_run_id=$4,selection_history=selection_history||jsonb_build_array(jsonb_build_object('fromRunId',$5::text,'toRunId',$4::text,'basisRef',$6::text,'recordedAt',$7::text)) WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
        [
          input.subjectId,
          input.worldId,
          input.eventId,
          input.newRunId,
          input.expectedRunId,
          input.basisRef,
          options.now(),
        ],
      );
      return true;
    },
    /** Adopts only the trusted actual admission receipt of the run that owns this selection. */
    async acknowledgeContact(value: Static<typeof acknowledgeWorldContactSchema>) {
      const input = checked<Static<typeof acknowledgeWorldContactSchema>>(
        acknowledgeWorldContactSchema,
        value,
      );
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await options.lockSubject(tx, input.subjectId);
          const rows = await executeRepositorySql<{
            contact_ref: string;
            selected_run_id: string | null;
            state: string;
          }>(
            tx,
            "SELECT contact_ref,selected_run_id,state FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=$3 FOR UPDATE",
            [input.subjectId, input.worldId, input.eventId],
          );
          const selected = rows[0];
          if (
            !selected ||
            selected.contact_ref !== input.contactRef ||
            (selected.selected_run_id !== input.runId &&
              !(selected.state === "released" && selected.selected_run_id === null))
          )
            conflict(
              "Only the selected actual run may acknowledge this exact canonical contact",
            );
          if (selected.state !== "released")
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.world_contact_release SET state='released',recorded_at=$4 WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
              [input.subjectId, input.worldId, input.eventId, options.now()],
            );
          return { contactRef: input.contactRef };
        }),
      );
    },
  };
}
