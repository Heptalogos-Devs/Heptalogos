// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects immutable WorkQueue profiles to DBOS database-backed queues and
 * verifies the persisted configuration without granting DBOS policy Authority.
 * @module queue-profiles
 */

import {
  isWorkQueueProfilePartitioned,
  type WorkQueueProfileCatalog,
  type WorkQueueProfileDefinition,
} from "@heptalogos/work-queue";
import { durableExecutionProblem } from "../problems.js";

/** The only queue conflict behavior permitted by the durable runtime. */
const DBOS_QUEUE_CONFLICT_POLICY = "never_update" as const;

/** DBOS rate-limit shape kept behind the durable-execution boundary. */
interface DbosQueueRateLimit {
  readonly limitPerPeriod: number;
  readonly periodSec: number;
}

/** DBOS queue registration parameters projected from a WorkQueue profile. */
export interface DbosQueueRegistrationOptions {
  readonly globalConcurrency?: number;
  readonly workerConcurrency?: number;
  readonly rateLimit?: DbosQueueRateLimit;
  readonly partitionConcurrency?: number;
  readonly partitionWorkerConcurrency?: number;
  readonly partitionRateLimit?: DbosQueueRateLimit;
  readonly minPollingIntervalMs: number;
  readonly onConflict: typeof DBOS_QUEUE_CONFLICT_POLICY;
}

/** Minimal queue readback used to verify the DBOS persisted projection. */
export interface DbosQueueHandle {
  /** Read the persisted queue-wide concurrency limit. */
  getGlobalConcurrency(): Promise<number | undefined>;
  /** Read the persisted per-worker concurrency limit. */
  getWorkerConcurrency(): Promise<number | undefined>;
  /** Read the persisted queue-wide rate limit. */
  getRateLimit(): Promise<DbosQueueRateLimit | undefined>;
  /** Read the persisted per-partition concurrency limit. */
  getPartitionConcurrency(): Promise<number | undefined>;
  /** Read the persisted per-worker partition concurrency limit. */
  getPartitionWorkerConcurrency(): Promise<number | undefined>;
  /** Read the persisted per-partition rate limit. */
  getPartitionRateLimit(): Promise<DbosQueueRateLimit | undefined>;
  /** Read whether the persisted queue has partition mechanics enabled. */
  getPartitionQueue(): Promise<boolean>;
  /** Read the persisted minimum queue polling interval. */
  getMinPollingIntervalMs(): Promise<number | undefined>;
}

/** Queue-registration seam used by the runtime without exposing DBOS types. */
export interface DbosQueueRegistrationDriver {
  /** Register or read one named DBOS queue with the supplied parameters. */
  registerQueue(
    name: string,
    options: DbosQueueRegistrationOptions,
  ): Promise<DbosQueueHandle>;
}

function queueName(profile: WorkQueueProfileDefinition): string {
  return `heptalogos.queue.${String(profile.profileId)}`;
}

function rateLimit(
  value: WorkQueueProfileDefinition["rateLimit"],
): DbosQueueRateLimit | undefined {
  return value === undefined
    ? undefined
    : {
        limitPerPeriod: value.limitPerPeriod,
        periodSec: value.periodSeconds,
      };
}

function partitionRateLimit(
  profile: WorkQueueProfileDefinition,
): DbosQueueRateLimit | undefined {
  return rateLimit(profile.partition?.rateLimit);
}

/** Maps one WorkQueue profile to the current DBOS 4.27 queue parameter names. */
export function projectDbosQueueOptions(
  profile: WorkQueueProfileDefinition,
): DbosQueueRegistrationOptions {
  const partition = profile.partition;
  return {
    ...(profile.globalConcurrency === undefined
      ? {}
      : { globalConcurrency: profile.globalConcurrency }),
    ...(profile.workerConcurrency === undefined
      ? {}
      : { workerConcurrency: profile.workerConcurrency }),
    ...(profile.rateLimit === undefined
      ? {}
      : { rateLimit: rateLimit(profile.rateLimit) }),
    ...(partition?.concurrency === undefined
      ? {}
      : { partitionConcurrency: partition.concurrency }),
    ...(partition?.workerConcurrency === undefined
      ? {}
      : { partitionWorkerConcurrency: partition.workerConcurrency }),
    ...(partition?.rateLimit === undefined
      ? {}
      : { partitionRateLimit: partitionRateLimit(profile) }),
    minPollingIntervalMs: profile.minPollingIntervalMs,
    onConflict: DBOS_QUEUE_CONFLICT_POLICY,
  };
}

interface DbosQueueReadback {
  readonly globalConcurrency: number | undefined;
  readonly workerConcurrency: number | undefined;
  readonly rateLimit: DbosQueueRateLimit | undefined;
  readonly partitionConcurrency: number | undefined;
  readonly partitionWorkerConcurrency: number | undefined;
  readonly partitionRateLimit: DbosQueueRateLimit | undefined;
  readonly partitionQueue: boolean;
  readonly minPollingIntervalMs: number | undefined;
}

async function readback(queue: DbosQueueHandle): Promise<DbosQueueReadback> {
  const [
    globalConcurrency,
    workerConcurrency,
    rateLimitValue,
    partitionConcurrency,
    partitionWorkerConcurrency,
    partitionRateLimitValue,
    partitionQueue,
    minPollingIntervalMs,
  ] = await Promise.all([
    queue.getGlobalConcurrency(),
    queue.getWorkerConcurrency(),
    queue.getRateLimit(),
    queue.getPartitionConcurrency(),
    queue.getPartitionWorkerConcurrency(),
    queue.getPartitionRateLimit(),
    queue.getPartitionQueue(),
    queue.getMinPollingIntervalMs(),
  ]);
  return {
    globalConcurrency,
    workerConcurrency,
    rateLimit: rateLimitValue,
    partitionConcurrency,
    partitionWorkerConcurrency,
    partitionRateLimit: partitionRateLimitValue,
    partitionQueue,
    minPollingIntervalMs,
  };
}

function ratesEqual(
  expected: DbosQueueRateLimit | undefined,
  actual: DbosQueueRateLimit | undefined,
): boolean {
  return expected === undefined || actual === undefined
    ? expected === actual
    : expected.limitPerPeriod === actual.limitPerPeriod &&
        expected.periodSec === actual.periodSec;
}

function profileMatches(
  profile: WorkQueueProfileDefinition,
  actual: DbosQueueReadback,
): boolean {
  const partition = profile.partition;
  return (
    profile.globalConcurrency === actual.globalConcurrency &&
    profile.workerConcurrency === actual.workerConcurrency &&
    ratesEqual(rateLimit(profile.rateLimit), actual.rateLimit) &&
    (partition?.concurrency ?? undefined) === actual.partitionConcurrency &&
    (partition?.workerConcurrency ?? undefined) === actual.partitionWorkerConcurrency &&
    ratesEqual(partitionRateLimit(profile), actual.partitionRateLimit) &&
    isWorkQueueProfilePartitioned(profile) === actual.partitionQueue &&
    profile.minPollingIntervalMs === actual.minPollingIntervalMs
  );
}

function mismatch(profile: WorkQueueProfileDefinition, cause?: unknown): never {
  throw durableExecutionProblem(
    "durable_execution.queue_profile_mismatch",
    `DBOS queue '${queueName(profile)}' does not match the current WorkQueue profile`,
    cause,
  );
}

/** Registers or reads one queue without overwriting a persisted profile. */
async function projectOne(
  profile: WorkQueueProfileDefinition,
  driver: DbosQueueRegistrationDriver,
): Promise<void> {
  const name = queueName(profile);
  const options = projectDbosQueueOptions(profile);
  let queue: DbosQueueHandle;
  try {
    queue = await driver.registerQueue(name, options);
    const actual = await readback(queue);
    if (!profileMatches(profile, actual)) mismatch(profile);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "problem" in error &&
      (error as { readonly problem?: { readonly problemCode?: unknown } }).problem
        ?.problemCode === "durable_execution.queue_profile_mismatch"
    ) {
      throw error;
    }
    mismatch(profile, error);
  }
}

/** Projects and verifies every current WorkQueue profile in catalog order. */
export async function projectWorkQueueProfiles(
  profiles: WorkQueueProfileCatalog,
  driver: DbosQueueRegistrationDriver,
): Promise<void> {
  for (const profile of profiles.list()) {
    await projectOne(profile, driver);
  }
}
