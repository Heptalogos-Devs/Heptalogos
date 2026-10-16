// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Validates an adopted professional task against its actual decision and current world sources.
 * @module adopted-task-sources
 */
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import type {
  createDeliberationService,
  createLifeService,
  createWorldLifeService,
} from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
import type { Registration, NativeRunSnapshot } from "./native-cognition.js";
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((value) => b.includes(value));
function denied(): never {
  throw managementProblem(
    "gateway.native_adopted_task_denied",
    "Professional task sources are not authorized",
    "Use the exact same-Subject adopted decision, source parent, task sources/tools and currently released world scope",
    "authorization",
  );
}
/** Invoked before registration and again using its existing fenced transaction. */
export async function authorizeAdoptedTaskSources(
  options: {
    decisions: Pick<ReturnType<typeof createDeliberationService>, "read">;
    life: Pick<ReturnType<typeof createLifeService>, "get">;
    worlds: Pick<
      ReturnType<typeof createWorldLifeService>,
      "resolveSourceRefs" | "releasedEventIds"
    >;
  },
  registration: Readonly<Registration>,
  parent: NativeRunSnapshot,
  transaction?: PersistenceInternalTransaction,
): Promise<void> {
  if (
    !registration.adoptedDecisionRef ||
    registration.roleScope.role !== "subject.execution" ||
    !parent.consumerId ||
    parent.registration.roleScope.role !== "subject.deliberation" ||
    registration.parentRunId !== parent.runId
  )
    denied();
  const adopted = await options.decisions.read(
    registration.subjectId,
    registration.adoptedDecisionRef,
    transaction,
  );
  const task = adopted?.decision.delegation;
  if (
    !adopted ||
    !task ||
    adopted.subjectId !== registration.subjectId ||
    adopted.activityId !== registration.activityId ||
    parent.registration.subjectId !== adopted.subjectId ||
    parent.registration.activityId !== adopted.activityId ||
    adopted.sourceRunId !== parent.runId ||
    !same(task.sourceRefs, registration.sourceRefs) ||
    !same(task.tools, registration.allowedToolNames) ||
    registration.sourceRefs.some((ref) => !adopted.sourceRefs.includes(ref))
  )
    denied();
  const activity = await options.life.get(
    registration.subjectId,
    registration.activityId,
    transaction,
  );
  if (
    !activity?.scope ||
    activity.state !== "active" ||
    activity.continuationRequired ||
    activity.adoptedBy !== registration.actorEntityRef ||
    task.tools.some((tool) => !activity.scope!.tools.includes(tool))
  )
    denied();
  const extra = registration.sourceRefs.filter(
    (ref) => !parent.registration.sourceRefs.includes(ref),
  );
  if (!extra.length) return;
  const canonical = await options.worlds.resolveSourceRefs(
    { subjectId: registration.subjectId, sourceRefs: extra },
    transaction,
  );
  const worlds = new Map<string, string[]>();
  for (const ref of extra) {
    const event = /^world-event:([0-9a-f-]{36}):([0-9a-f-]{36}):([1-9][0-9]*)$/i.exec(
      ref,
    );
    if (
      !event ||
      !canonical.includes(ref) ||
      !(
        activity.scope.sourceRefs.includes(`world:${event[1]}`) ||
        activity.scope.sourceRefs.includes(ref)
      )
    )
      denied();
    worlds.set(event[1]!, [...(worlds.get(event[1]!) ?? []), event[2]!]);
  }
  for (const [worldId, eventIds] of worlds) {
    const released = await options.worlds.releasedEventIds(
      registration.subjectId,
      worldId,
      eventIds,
      transaction,
    );
    if (eventIds.some((id) => !released.includes(id))) denied();
  }
}
