// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Derives energy from realized nonduplicated world intervals and owns one device view.
 * @module world-living
 */
import {
  executeRepositorySql,
  readRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  realizedWorldEventSchema,
  type RealizedWorldEvent,
} from "./world-contracts.js";
import {
  adoptedWorldProfileSchema,
  worldLivingStateSchema,
  adoptWorldDeviceViewSchema,
  type AdoptedWorldProfile,
  type WorldLivingState,
  type AdoptWorldDeviceView,
} from "./world-profile-contracts.js";
import { subjectProblem } from "./problems.js";
import { worldIntervalBoundaries } from "./world-interval-boundaries.js";
function conflict(detail: string): never {
  throw subjectProblem(
    "world.living_conflict",
    "Living state cannot be adopted",
    detail,
    "conflict",
  );
}
function parse<T>(schema: Parameters<typeof compileSchema<T>>[0], value: unknown): T {
  const result = compileSchema<T>(schema).validate(value);
  if (!result.ok) conflict("Use the canonical world living contract");
  return result.value;
}
const clamp = (value: number) => Math.max(0, Math.min(100, value));
/** One primary rate plus the maximum subsidiary positive burden, never a per-worker charge. */
export function integrateWorldEnergy(
  profile: AdoptedWorldProfile,
  baseline: WorldLivingState,
  events: readonly RealizedWorldEvent[],
  until: string,
  revisions: readonly AdoptedWorldProfile[] = [profile],
): Pick<
  WorldLivingState,
  "energy" | "integratedThrough" | "coverage" | "energyExplanation"
> {
  const start = Date.parse(baseline.integratedThrough.at),
    end = Date.parse(until);
  if (end < start) conflict("Energy cannot advance backwards");
  const policies = [...revisions]
    .filter(
      (record) =>
        record.policyEffectiveAt.timeDomainRef ===
        baseline.integratedThrough.timeDomainRef,
    )
    .sort(
      (a, b) =>
        Date.parse(a.policyEffectiveAt.at) - Date.parse(b.policyEffectiveAt.at) ||
        a.revision - b.revision,
    );
  const relevant = events.filter(
    (event) =>
      event.interval.timeDomainRef === baseline.integratedThrough.timeDomainRef &&
      event.energy &&
      Date.parse(event.interval.end) > start &&
      Date.parse(event.interval.start) < end,
  );
  const points = worldIntervalBoundaries(
    start,
    end,
    relevant,
    policies.map((record) => Date.parse(record.policyEffectiveAt.at)),
  );
  let energy = baseline.energy,
    covered = 0,
    totalDuration = 0,
    deltaTotal = 0;
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1]!,
      right = points[index]!;
    const policy =
      [...policies]
        .reverse()
        .find((record) => Date.parse(record.policyEffectiveAt.at) <= left)?.profile
        .energy ?? profile.profile.energy;
    const active = relevant.filter(
      (event) =>
        Date.parse(event.interval.start) < right &&
        Date.parse(event.interval.end) > left,
    );
    if (
      active.some((event) => event.energy!.kind === "study") &&
      active.some(
        (event) =>
          event.energy!.kind === "sleep" ||
          (event.energy!.kind === "rest" && event.energy!.participation === "primary"),
      )
    )
      conflict(
        "Sleep/recovery and active study cannot be realized as the same body's concurrent activity",
      );
    const primary = active.filter((event) => event.energy!.participation === "primary");
    if (primary.length > 1)
      conflict(
        "Mutually overlapping primary activities cannot provide two energy rates",
      );
    const main = primary[0]?.energy,
      subsidiary = Math.max(
        0,
        ...active
          .filter((event) => event.energy!.participation === "subsidiary")
          .map((event) => Math.max(0, -policy.rates[event.energy!.kind])),
      );
    const hours = (right - left) / 3600000;
    energy = clamp(
      energy +
        ((main ? policy.rates[main.kind] : 0) -
          policy.subsidiaryBurdenRatio * subsidiary) *
          hours,
    );
    totalDuration += hours;
    if (main) covered += hours;
    for (const event of relevant
      .filter((event) => Date.parse(event.interval.end) === right)
      .sort((a, b) => a.eventId.localeCompare(b.eventId))) {
      const delta = event.energy!.delta;
      if (Math.abs(delta) > 10 || (delta !== 0 && !event.energy!.reason.trim()))
        conflict("An adopted event delta needs a bounded explicit source appraisal");
      energy = clamp(energy + delta);
      deltaTotal += delta;
    }
  }
  return {
    energy,
    integratedThrough: { ...baseline.integratedThrough, at: until },
    coverage: covered < totalDuration ? "limited" : "complete",
    energyExplanation: `${covered.toFixed(3)} realized primary world hours; subsidiary burden uses its maximum; adopted event delta ${deltaTotal}; effective profile revisions ${policies.map((record) => record.revision).join(",")}.`,
  };
}
/** Read model never advances the world or turns planned sleep into realized recovery. */
export async function readWorldLiving(
  options: { persistence: PersistenceService },
  input: { subjectId: string; worldId: string },
): Promise<WorldLivingState | undefined> {
  const rows = await readRepositorySql<{ document: unknown }>(
    options.persistence,
    "SELECT document FROM heptalogos.world_living WHERE subject_id=$1 AND world_id=$2",
    [input.subjectId, input.worldId],
  );
  return rows[0]
    ? parse<WorldLivingState>(worldLivingStateSchema, rows[0].document)
    : undefined;
}
/** Caller holds the Subject/world lock; integration and realized event adoption share the same short transaction. */
export async function integrateWorldLivingIn(
  tx: PersistenceInternalTransaction,
  input: {
    subjectId: string;
    worldId: string;
    worldRevision: number;
    events: readonly RealizedWorldEvent[];
    now: string;
  },
): Promise<void> {
  if (!input.events.length) return;
  const rows = await executeRepositorySql<{ document: unknown; profile: unknown }>(
    tx,
    "SELECT l.document,p.document AS profile FROM heptalogos.world_living l JOIN heptalogos.world_profile p USING(subject_id,world_id) WHERE l.subject_id=$1 AND l.world_id=$2 FOR UPDATE OF l",
    [input.subjectId, input.worldId],
  );
  if (!rows[0]) return;
  const current = parse<WorldLivingState>(worldLivingStateSchema, rows[0].document),
    profile = parse<AdoptedWorldProfile>(adoptedWorldProfileSchema, rows[0].profile);
  const affecting = input.events.filter((event) =>
    event.actorRefs.includes(profile.subjectActorRef),
  );
  if (!affecting.length) return;
  const earliest = affecting.reduce(
    (at, event) =>
      Date.parse(event.interval.start) < Date.parse(at) ? event.interval.start : at,
    affecting[0]!.interval.start,
  );
  const until = affecting.reduce(
    (at, event) =>
      Date.parse(event.interval.end) > Date.parse(at) ? event.interval.end : at,
    current.integratedThrough.at,
  );
  let baseline = current;
  if (Date.parse(earliest) < Date.parse(current.integratedThrough.at)) {
    const previous = await executeRepositorySql<{ document: unknown }>(
      tx,
      "SELECT document FROM heptalogos.world_living_history WHERE subject_id=$1 AND world_id=$2 AND integrated_through<$3::timestamptz ORDER BY integrated_through DESC,revision DESC LIMIT 1",
      [input.subjectId, input.worldId, earliest],
    );
    baseline = previous[0]
      ? parse<WorldLivingState>(worldLivingStateSchema, previous[0].document)
      : {
          ...current,
          energy: profile.profile.energy.initial,
          integratedThrough: {
            timeDomainRef: profile.profile.timeDomainRef,
            at: profile.profile.entry.at,
          },
        };
  }
  const material = await executeRepositorySql<{ document: unknown }>(
    tx,
    "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND time_domain_ref=$3 AND occurred_end>$4::timestamptz AND occurred_start<$5::timestamptz AND document->'actorRefs' ? $6 ORDER BY occurred_start,event_id",
    [
      input.subjectId,
      input.worldId,
      baseline.integratedThrough.timeDomainRef,
      baseline.integratedThrough.at,
      until,
      profile.subjectActorRef,
    ],
  );
  const events = material.map((row) =>
    parse<RealizedWorldEvent>(realizedWorldEventSchema, row.document),
  );
  const policyRows = await executeRepositorySql<{ document: unknown }>(
    tx,
    "SELECT document FROM heptalogos.world_profile_history WHERE subject_id=$1 AND world_id=$2 AND ((effective_at>$3::timestamptz AND effective_at<=$4::timestamptz) OR revision=(SELECT revision FROM heptalogos.world_profile_history WHERE subject_id=$1 AND world_id=$2 AND effective_at<=$3::timestamptz ORDER BY effective_at DESC,revision DESC LIMIT 1)) ORDER BY effective_at,revision",
    [input.subjectId, input.worldId, baseline.integratedThrough.at, until],
  );
  const policies = policyRows.map((row) =>
    parse<AdoptedWorldProfile>(adoptedWorldProfileSchema, row.document),
  );
  const integrated = integrateWorldEnergy(profile, baseline, events, until, policies);
  const latest = [...events].sort(
    (a, b) =>
      Date.parse(b.interval.end) - Date.parse(a.interval.end) ||
      b.eventId.localeCompare(a.eventId),
  )[0];
  const next: WorldLivingState = {
    ...current,
    ...integrated,
    revision: current.revision + 1,
    profileRevision: profile.revision,
    currentPlaceRef: latest?.placeRef ?? current.currentPlaceRef,
    currentActivityRefs: latest?.activityId
      ? [latest.activityId]
      : current.currentActivityRefs,
    updatedAt: input.now,
  };
  await executeRepositorySql(
    tx,
    "UPDATE heptalogos.world_living SET document=$3::jsonb WHERE subject_id=$1 AND world_id=$2",
    [input.subjectId, input.worldId, JSON.stringify(next)],
  );
  await executeRepositorySql(
    tx,
    "INSERT INTO heptalogos.world_living_history(subject_id,world_id,revision,integrated_through,document) VALUES($1,$2,$3,$4,$5::jsonb)",
    [
      input.subjectId,
      input.worldId,
      next.revision,
      next.integratedThrough.at,
      JSON.stringify(next),
    ],
  );
}
/** The Reactor supplies real focus authority; this owner only adopts the resulting device view under its own CAS. */
export async function adoptWorldDeviceIn(
  tx: PersistenceInternalTransaction,
  value: AdoptWorldDeviceView,
  now: string,
): Promise<WorldLivingState["device"]> {
  const input = parse<AdoptWorldDeviceView>(adoptWorldDeviceViewSchema, value);
  const digest = digestCanonicalJson(
    "world.operation.v1",
    input as unknown as CanonicalJsonValue,
  ).hex;
  const saved = await executeRepositorySql<{
    request_digest: string;
    document: WorldLivingState["device"];
  }>(
    tx,
    "SELECT request_digest,document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
    [input.subjectId, input.operationId],
  );
  if (saved[0]) {
    if (saved[0].request_digest !== digest)
      conflict("This device operation already binds another view");
    return saved[0].document;
  }
  const rows = await executeRepositorySql<{ document: unknown }>(
    tx,
    "SELECT document FROM heptalogos.world_living WHERE subject_id=$1 AND world_id=$2 FOR UPDATE",
    [input.subjectId, input.worldId],
  );
  if (!rows[0]) conflict("Adopt the world's living profile before using its device");
  const current = parse<WorldLivingState>(worldLivingStateSchema, rows[0].document);
  if (current.device.revision !== input.expectedRevision)
    conflict("The actual device view changed");
  const device = { revision: current.device.revision + 1, view: input.view };
  await executeRepositorySql(
    tx,
    "UPDATE heptalogos.world_living SET document=$3::jsonb WHERE subject_id=$1 AND world_id=$2",
    [
      input.subjectId,
      input.worldId,
      JSON.stringify({ ...current, device, updatedAt: now }),
    ],
  );
  await executeRepositorySql(
    tx,
    "INSERT INTO heptalogos.world_realization(subject_id,world_id,operation_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
    [
      input.subjectId,
      input.worldId,
      input.operationId,
      digest,
      JSON.stringify(device),
      now,
    ],
  );
  return device;
}
