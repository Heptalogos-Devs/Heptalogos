// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps package-resolution and DBOS-process failures to Foundation Problems so
 * provider-specific exceptions never cross the durable-execution boundary.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
  type RetryClass,
} from "@heptalogos/foundation-contracts";

const specs: Readonly<
  Record<
    string,
    {
      readonly category: string;
      readonly retryClass: RetryClass;
      readonly title: string;
    }
  >
> = {
  "durable.execution.package.not_installed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "DBOS package is not installed",
  },
  "durable.execution.package.invalid_metadata": {
    category: "integrity",
    retryClass: "manual",
    title: "DBOS package metadata is invalid",
  },
  "durable.execution.package.invalid_version": {
    category: "validation",
    retryClass: "manual",
    title: "DBOS package version is not qualified",
  },
  "durable.execution.package.invalid_cli": {
    category: "integrity",
    retryClass: "manual",
    title: "DBOS CLI entry is invalid",
  },
  "durable.execution.process.invalid_options": {
    category: "validation",
    retryClass: "never",
    title: "DBOS process options are invalid",
  },
  "durable.execution.process.invalid_executable": {
    category: "validation",
    retryClass: "manual",
    title: "DBOS CLI entry path is invalid",
  },
  "durable.execution.process.timed_out": {
    category: "unavailable",
    retryClass: "backoff",
    title: "DBOS CLI invocation timed out",
  },
  "durable.execution.process.output_limit": {
    category: "integrity",
    retryClass: "manual",
    title: "DBOS CLI output exceeded its bound",
  },
  "durable.execution.process.launch_failed": {
    category: "unavailable",
    retryClass: "backoff",
    title: "DBOS CLI could not be launched",
  },
  "durable.execution.schema.invalid_options": {
    category: "validation",
    retryClass: "never",
    title: "DBOS schema provisioner options are invalid",
  },
  "durable.execution.schema.provision_failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "DBOS schema provisioning failed",
  },
  "durable.execution.schema.verification_failed": {
    category: "integrity",
    retryClass: "manual",
    title: "DBOS schema verification failed",
  },
  "durable.execution.runtime.invalid_options": {
    category: "validation",
    retryClass: "never",
    title: "DurableExecution runtime options are invalid",
  },
  "durable.execution.runtime.invalid_transition": {
    category: "conflict",
    retryClass: "manual",
    title: "DurableExecution lifecycle transition is invalid",
  },
  "durable.execution.runtime.authority_lost": {
    category: "conflict",
    retryClass: "after-change",
    title: "DurableExecution Host authority is no longer active",
  },
  "durable.execution.binding.active": {
    category: "conflict",
    retryClass: "after-change",
    title: "A DurableExecution binding is already active",
  },
  "durable.execution.binding.recovery_budget_mismatch": {
    category: "integrity",
    retryClass: "manual",
    title: "Process-global DBOS recovery budget does not match",
  },
  "durable.execution.binding.missing": {
    category: "unavailable",
    retryClass: "after-change",
    title: "No active DurableExecution binding exists",
  },
  "durable.execution.dispatch.not_open": {
    category: "conflict",
    retryClass: "after-change",
    title: "DurableExecution dispatch admission is closed",
  },
  "durable.execution.dispatch.invalid_request": {
    category: "validation",
    retryClass: "never",
    title: "DurableExecution dispatch request is invalid",
  },
  "durable.execution.dispatch.profile_missing": {
    category: "integrity",
    retryClass: "after-change",
    title: "DurableExecution queue profile is unavailable",
  },
  "durable.execution.dispatch.partition_required": {
    category: "validation",
    retryClass: "never",
    title: "DurableExecution partition key is required",
  },
  "durable.execution.dispatch.partition_not_supported": {
    category: "validation",
    retryClass: "never",
    title: "DurableExecution partition key is not supported",
  },
  "durable.execution.inspection.invalid_request": {
    category: "validation",
    retryClass: "never",
    title: "DurableExecution inspection request is invalid",
  },
  "durable.execution.inspection.failed": {
    category: "unavailable",
    retryClass: "backoff",
    title: "DBOS workflow inspection failed",
  },
  "durable_execution.queue_profile_mismatch": {
    category: "integrity",
    retryClass: "manual",
    title: "Persisted DBOS queue profile does not match WorkQueue policy",
  },
};

/** Creates a stable durable-execution Problem with an optional operational cause. */
export function durableExecutionProblem(
  problemCode: string,
  detail: string,
  cause?: unknown,
): ProblemError {
  const spec = specs[problemCode] ?? {
    category: "unavailable",
    retryClass: "after-change" as const,
    title: "Durable-execution operation failed",
  };
  const problem: Problem = {
    schemaVersion: 1,
    problemCode,
    category: spec.category,
    retryClass: spec.retryClass,
    title: spec.title,
    detail,
  };
  return createProblemError(problem, cause === undefined ? undefined : { cause });
}
