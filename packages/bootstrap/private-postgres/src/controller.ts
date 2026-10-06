// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Coordinates bounded private PostgreSQL controller operations and verifies
 * installation identity before process lifecycle actions are admitted.
 * @module controller
 */

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  asContentDigest,
  createProblemError,
  digestCanonicalJson,
  ProblemError,
  type CanonicalJsonValue,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
  PRIVATE_POSTGRES_DATA_LAYOUT_VERSION,
  PRIVATE_POSTGRES_RELATIVE_DATA_PATH,
  type PrivatePostgresExpectedIdentity,
  type PrivatePostgresInitializationProfile,
  type PrivatePostgresInitializationProfileRevision,
  type PrivatePostgresInitializationResult,
  type PrivatePostgresLifecycleOptions,
  type PrivatePostgresControlGuard,
  type PrivatePostgresPlacement,
  type PrivatePostgresStartupDisposition,
  type PrivatePostgresToolchain,
} from "./contracts.js";
import { withRestrictedPasswordFile } from "./credential-file.js";
import {
  classifyClusterDirectory,
  type ClusterDirectoryState,
} from "./cluster-layout.js";
import { inspectPrivatePostgresCluster } from "./cluster-inspection.js";
import { runPostgresTool } from "./process-adapter.js";
import {
  createCanonicalHbaProfile,
  inspectEffectivePrivatePostgresProfile,
  readCanonicalHbaProfile,
  writeCanonicalPrivatePostgresRuntimeProfile,
} from "./runtime-profile.js";
import {
  createPrivatePostgresLifecycleTracker,
  type PrivatePostgresLifecycleTracker,
} from "./lifecycle-machine.js";
import {
  lifecycleProcessOptions,
  readPrivatePostgresProcessStatus,
  runPrivatePostgresCtlChecked,
  waitForPrivatePostgresReadiness,
  processTimeoutSeconds,
  type PrivatePostgresProcessStatus,
} from "./lifecycle-process.js";
import { assertPrivatePostgresPort } from "./port.js";

/** Supplies inputs for private cluster initialization and control checks. */
export interface InitializePrivatePostgresClusterOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly credentialTempRoot: string;
  readonly bootstrapPasswordUtf8: Uint8Array;
  readonly port: number;
  readonly lifecycle: PrivatePostgresLifecycleOptions;
  readonly assertControlAuthority: PrivatePostgresControlGuard;
}

/** Supplies inputs for validating an existing private cluster. */
export interface ValidateExistingPrivatePostgresClusterOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly expectedIdentity: PrivatePostgresExpectedIdentity;
  readonly timeoutMs: number;
}

/** Supplies inputs for starting a validated private cluster. */
export interface StartPrivatePostgresClusterOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly expectedIdentity: PrivatePostgresExpectedIdentity;
  readonly logFilePath: string;
  readonly lifecycle: PrivatePostgresLifecycleOptions;
  readonly assertControlAuthority: PrivatePostgresControlGuard;
}

function controllerProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function assertLifecycleOptions(options: PrivatePostgresLifecycleOptions): void {
  if (
    !Number.isInteger(options.startupTimeoutMs) ||
    options.startupTimeoutMs <= 0 ||
    !Number.isInteger(options.shutdownTimeoutMs) ||
    options.shutdownTimeoutMs <= 0 ||
    !Number.isInteger(options.readinessPollIntervalMs) ||
    options.readinessPollIntervalMs <= 0
  ) {
    throw controllerProblem(
      "private-postgres.lifecycle.invalid_options",
      "Private PostgreSQL lifecycle options are invalid",
      "Private PostgreSQL lifecycle budgets must be positive integer milliseconds",
      "validation",
    );
  }
}

/** Creates the canonical private PostgreSQL initialization profile. */
export function createPrivatePostgresInitializationProfile(
  port: number,
): PrivatePostgresInitializationProfile {
  assertPrivatePostgresPort(port);
  return Object.freeze({
    bootstrapRoleName: PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
    encoding: "UTF8",
    dataChecksums: true,
    hostAuthentication: "scram-sha-256",
    listenAddress: "127.0.0.1",
    unixSocketDirectories: "",
    persistedPort: port,
  });
}

/** Derives the content identity of the initialization profile. */
export function createPrivatePostgresInitializationProfileRevision(
  port: number,
): PrivatePostgresInitializationProfileRevision {
  const profile = createPrivatePostgresInitializationProfile(port);
  return asContentDigest(
    "PrivatePostgresInitializationProfileRevision",
    digestCanonicalJson(
      "heptalogos.private-postgres.initialization-profile/v1",
      profile as unknown as CanonicalJsonValue,
    ),
  );
}

function initializationArgs(
  dataDirectory: string,
  passwordFilePath: string,
): readonly string[] {
  return [
    "--pgdata",
    dataDirectory,
    "--encoding=UTF8",
    "--data-checksums",
    "--auth-host=scram-sha-256",
    "--auth-local=scram-sha-256",
    `--username=${PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME}`,
    `--pwfile=${passwordFilePath}`,
  ];
}

async function assertFirstInitializationTarget(
  placement: PrivatePostgresPlacement,
): Promise<void> {
  const state: ClusterDirectoryState = await classifyClusterDirectory(
    placement.canonicalDataDirectory,
  );
  if (state.kind === "NON_EMPTY") {
    throw controllerProblem(
      "private-postgres.cluster.non_empty_target",
      "Private PostgreSQL target is not eligible for first initialization",
      "A non-empty private PostgreSQL target requires authoritative BootstrapState and cannot be adopted or overwritten",
      "conflict",
    );
  }
}

/** Initializes the private cluster and returns verified identity evidence. */
export async function initializePrivatePostgresCluster(
  options: InitializePrivatePostgresClusterOptions,
): Promise<PrivatePostgresInitializationResult> {
  assertPrivatePostgresPort(options.port);
  await assertFirstInitializationTarget(options.placement);

  const initializationProfileRevision =
    createPrivatePostgresInitializationProfileRevision(options.port);
  const initResult = await withRestrictedPasswordFile(
    options.credentialTempRoot,
    options.bootstrapPasswordUtf8,
    async (passwordFilePath) => {
      options.assertControlAuthority();
      return runPostgresTool(
        options.toolchain.initdb,
        initializationArgs(options.placement.canonicalDataDirectory, passwordFilePath),
        { timeoutMs: options.lifecycle.startupTimeoutMs },
      );
    },
  );

  if (initResult.exitCode !== 0) {
    throw controllerProblem(
      "private-postgres.cluster.init_failed",
      "Private PostgreSQL cluster initialization failed",
      "initdb did not complete successfully; the partial target remains visible for bounded recovery",
      "unavailable",
    );
  }

  options.assertControlAuthority();
  await writeCanonicalPrivatePostgresRuntimeProfile(
    options.placement.canonicalDataDirectory,
    options.port,
  );
  const inspection = await inspectPrivatePostgresCluster(
    options.toolchain,
    options.placement.canonicalDataDirectory,
    { timeoutMs: options.lifecycle.startupTimeoutMs },
  );
  if (inspection.dataPageChecksumVersion !== 1) {
    throw controllerProblem(
      "private-postgres.cluster.checksums_disabled",
      "Private PostgreSQL data checksums are not enabled",
      "The initialized private PostgreSQL cluster did not report data page checksum version 1",
      "integrity",
    );
  }

  return Object.freeze({
    toolchain: options.toolchain,
    placement: options.placement,
    identity: {
      bootstrapRoleName: PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
      clusterSystemIdentifier: inspection.clusterSystemIdentifier,
      postgresMajor: inspection.postgresMajor,
    },
    port: options.port,
    initializationProfileRevision,
    dataPageChecksumVersion: inspection.dataPageChecksumVersion,
    databaseClusterState: inspection.databaseClusterState,
    catalogVersionNumber: inspection.catalogVersionNumber,
  });
}

/** Validates existing cluster identity, profile, and layout invariants. */
export async function validateExistingCluster(
  options: ValidateExistingPrivatePostgresClusterOptions,
): Promise<PrivatePostgresInitializationResult> {
  const expectedPlacement = options.expectedIdentity.placement;
  if (
    options.expectedIdentity.bootstrapRoleName !== PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME
  ) {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL bootstrap role does not match BootstrapState",
      "The persisted private PostgreSQL bootstrap role does not match the fixed cluster bootstrap identity",
    );
  }
  if (
    expectedPlacement.rootId !== "DATA" ||
    expectedPlacement.relativePath !== PRIVATE_POSTGRES_RELATIVE_DATA_PATH ||
    expectedPlacement.dataLayoutVersion !== PRIVATE_POSTGRES_DATA_LAYOUT_VERSION
  ) {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL placement does not match BootstrapState",
      "The existing cluster placement is not the authoritative DATA/private-postgres layout",
    );
  }

  const inspection = await inspectPrivatePostgresCluster(
    options.toolchain,
    options.placement.canonicalDataDirectory,
    { timeoutMs: options.timeoutMs },
  );
  if (
    inspection.postgresMajor !== options.expectedIdentity.postgresMajor ||
    inspection.clusterSystemIdentifier !==
      options.expectedIdentity.clusterSystemIdentifier ||
    inspection.dataPageChecksumVersion !== 1
  ) {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL cluster identity does not match BootstrapState",
      "The existing cluster major, system identifier, or checksum profile does not match the authoritative identity",
    );
  }

  const runtimeProfile = await inspectEffectivePrivatePostgresProfile(
    options.toolchain,
    options.placement.canonicalDataDirectory,
    options.timeoutMs,
  );
  let canonicalDataDirectory: string;
  let canonicalHbaPath: string;
  let effectiveDataDirectory: string;
  let effectiveHbaPath: string;
  try {
    canonicalDataDirectory = await realpath(options.placement.canonicalDataDirectory);
    canonicalHbaPath = await realpath(
      join(options.placement.canonicalDataDirectory, "pg_hba.conf"),
    );
    effectiveDataDirectory = await realpath(runtimeProfile.dataDirectory);
    effectiveHbaPath = await realpath(runtimeProfile.hbaFile);
  } catch {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL effective profile path is not authoritative",
      "The effective PostgreSQL data directory or HBA path could not be canonicalized",
    );
  }
  let hbaProfile: string;
  try {
    hbaProfile = await readCanonicalHbaProfile(canonicalHbaPath);
  } catch {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL HBA profile is not authoritative",
      "The authoritative private PostgreSQL HBA profile could not be read",
    );
  }
  if (
    runtimeProfile.listenAddress !== "127.0.0.1" ||
    runtimeProfile.unixSocketDirectories !== "" ||
    runtimeProfile.passwordEncryption !== "scram-sha-256" ||
    runtimeProfile.port !== options.expectedIdentity.persistedPort ||
    effectiveDataDirectory !== canonicalDataDirectory ||
    effectiveHbaPath !== canonicalHbaPath ||
    hbaProfile !== createCanonicalHbaProfile()
  ) {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL effective runtime profile does not match BootstrapState",
      "The effective PostgreSQL loopback, socket, port, encryption, data-directory, or HBA profile does not match the authoritative identity",
    );
  }

  const actualProfileRevision = createPrivatePostgresInitializationProfileRevision(
    runtimeProfile.port,
  );
  if (
    actualProfileRevision !== options.expectedIdentity.initializationProfileRevision
  ) {
    throw controllerProblem(
      "private-postgres.cluster.identity_mismatch",
      "Private PostgreSQL initialization profile does not match BootstrapState",
      "The existing cluster initialization profile revision does not match the authoritative identity",
    );
  }

  return Object.freeze({
    toolchain: options.toolchain,
    placement: options.placement,
    identity: {
      bootstrapRoleName: options.expectedIdentity.bootstrapRoleName,
      clusterSystemIdentifier: inspection.clusterSystemIdentifier,
      postgresMajor: inspection.postgresMajor,
    },
    port: runtimeProfile.port,
    initializationProfileRevision: actualProfileRevision,
    dataPageChecksumVersion: inspection.dataPageChecksumVersion,
    databaseClusterState: inspection.databaseClusterState,
    catalogVersionNumber: inspection.catalogVersionNumber,
  });
}

async function assertPrivatePostgresProcessRunning(
  options: StartPrivatePostgresClusterOptions,
): Promise<void> {
  const status = await readPrivatePostgresProcessStatus(
    lifecycleProcessOptions({
      ...options,
      persistedPort: options.expectedIdentity.persistedPort,
    }),
    controllerProblem,
  );
  if (status === "RUNNING") return;
  throw controllerProblem(
    "private-postgres.lifecycle.restart_failed",
    "Private PostgreSQL restart refused after process exit",
    "The validated private PostgreSQL process is no longer running; restart will not silently recover an unexpected exit",
    "unavailable",
  );
}

function startCleanupUncertainProblem(): ProblemError {
  return controllerProblem(
    "private-postgres.lifecycle.start_cleanup_uncertain",
    "Private PostgreSQL start cleanup is uncertain",
    "An issued PostgreSQL start or restart may still complete in the background and its process state could not be proven safely quiescent",
    "integrity",
  );
}

function stopUncertainProblem(): ProblemError {
  return controllerProblem(
    "private-postgres.lifecycle.stop_uncertain",
    "Private PostgreSQL stop is uncertain",
    "The private PostgreSQL process could not be proven stopped through the bounded stop path",
    "integrity",
  );
}

function alreadyRunningControlDeniedProblem(): ProblemError {
  return controllerProblem(
    "private-postgres.lifecycle.already_running_control_denied",
    "Already-running private PostgreSQL control is denied",
    "This PostgreSQL process was observed running before bootstrap started it; stop or restart requires the Host ownership handoff authority",
    "conflict",
  );
}

async function stopWithProof(
  options: StartPrivatePostgresClusterOptions,
  lifecycleState: PrivatePostgresLifecycleTracker,
  uncertainty: () => ProblemError,
): Promise<void> {
  if (lifecycleState.detail === "stopped") return;
  const processOptions = lifecycleProcessOptions({
    ...options,
    persistedPort: options.expectedIdentity.persistedPort,
  });

  let before: PrivatePostgresProcessStatus;
  try {
    before = await readPrivatePostgresProcessStatus(
      processOptions,
      controllerProblem,
      options.lifecycle.shutdownTimeoutMs,
    );
  } catch {
    throw uncertainty();
  }

  if (before === "STOPPED") {
    if (lifecycleState.can({ type: "STATUS_STOPPED_PROVEN" })) {
      lifecycleState.send({ type: "STATUS_STOPPED_PROVEN" });
      return;
    }
    if (lifecycleState.can({ type: "UNEXPECTED_PROCESS_EXIT" })) {
      lifecycleState.send({ type: "UNEXPECTED_PROCESS_EXIT" });
      lifecycleState.send({ type: "STATUS_STOPPED_PROVEN" });
      return;
    }
    throw uncertainty();
  }

  if (lifecycleState.can({ type: "STATUS_RUNNING_PROVEN" })) {
    lifecycleState.send({ type: "STATUS_RUNNING_PROVEN" });
  }
  if (!lifecycleState.can({ type: "STOP_COMMAND_ISSUED" })) {
    throw uncertainty();
  }

  try {
    options.assertControlAuthority();
  } catch {
    throw uncertainty();
  }
  lifecycleState.send({ type: "STOP_COMMAND_ISSUED" });
  try {
    await stopProcess(options);
  } catch {
    // A failed pg_ctl stop may still have stopped the process. The status probe
    // below is the only authority for whether cleanup completed.
  }

  let after: PrivatePostgresProcessStatus;
  try {
    after = await readPrivatePostgresProcessStatus(
      processOptions,
      controllerProblem,
      options.lifecycle.shutdownTimeoutMs,
    );
  } catch {
    if (lifecycleState.can({ type: "STOP_OUTCOME_UNCERTAIN" })) {
      lifecycleState.send({ type: "STOP_OUTCOME_UNCERTAIN" });
    }
    throw uncertainty();
  }
  if (after !== "STOPPED") {
    if (lifecycleState.can({ type: "STOP_OUTCOME_UNCERTAIN" })) {
      lifecycleState.send({ type: "STOP_OUTCOME_UNCERTAIN" });
    }
    throw uncertainty();
  }
  if (lifecycleState.can({ type: "STATUS_STOPPED_PROVEN" })) {
    lifecycleState.send({ type: "STATUS_STOPPED_PROVEN" });
    return;
  }
  throw uncertainty();
}

async function resolveAmbiguousStartForCleanup(
  options: StartPrivatePostgresClusterOptions,
  lifecycleState: PrivatePostgresLifecycleTracker,
): Promise<void> {
  await stopWithProof(options, lifecycleState, startCleanupUncertainProblem);
}

async function startProcess(
  options: StartPrivatePostgresClusterOptions,
  lifecycleState: PrivatePostgresLifecycleTracker,
): Promise<void> {
  options.assertControlAuthority();
  lifecycleState.send({ type: "START_COMMAND_ISSUED" });
  await runPrivatePostgresCtlChecked(
    lifecycleProcessOptions({
      ...options,
      persistedPort: options.expectedIdentity.persistedPort,
    }),
    [
      "start",
      "--pgdata",
      options.placement.canonicalDataDirectory,
      "--log",
      options.logFilePath,
      "--wait",
      "--timeout",
      processTimeoutSeconds(options.lifecycle.startupTimeoutMs),
    ],
    options.lifecycle.startupTimeoutMs,
    controllerProblem,
    "private-postgres.lifecycle.start_failed",
    "Private PostgreSQL start failed",
    "pg_ctl could not start the validated private PostgreSQL cluster",
    "ignore",
  );
}

async function restartProcess(
  options: StartPrivatePostgresClusterOptions,
  lifecycleState: PrivatePostgresLifecycleTracker,
): Promise<void> {
  options.assertControlAuthority();
  lifecycleState.send({ type: "RESTART_COMMAND_ISSUED" });
  await runPrivatePostgresCtlChecked(
    lifecycleProcessOptions({
      ...options,
      persistedPort: options.expectedIdentity.persistedPort,
    }),
    [
      "restart",
      "--pgdata",
      options.placement.canonicalDataDirectory,
      "--log",
      options.logFilePath,
      "--mode=fast",
      "--wait",
      "--timeout",
      processTimeoutSeconds(options.lifecycle.startupTimeoutMs),
    ],
    options.lifecycle.startupTimeoutMs,
    controllerProblem,
    "private-postgres.lifecycle.restart_failed",
    "Private PostgreSQL restart failed",
    "pg_ctl could not restart the validated private PostgreSQL cluster",
    "ignore",
  );
}

async function stopProcess(options: StartPrivatePostgresClusterOptions): Promise<void> {
  options.assertControlAuthority();
  await runPrivatePostgresCtlChecked(
    lifecycleProcessOptions({
      ...options,
      persistedPort: options.expectedIdentity.persistedPort,
    }),
    [
      "stop",
      "--pgdata",
      options.placement.canonicalDataDirectory,
      "--mode=fast",
      "--wait",
      "--timeout",
      processTimeoutSeconds(options.lifecycle.shutdownTimeoutMs),
    ],
    options.lifecycle.shutdownTimeoutMs,
    controllerProblem,
    "private-postgres.lifecycle.stop_failed",
    "Private PostgreSQL stop failed",
    "pg_ctl could not stop the private PostgreSQL cluster within the shutdown budget",
  );
}

/** Starts a validated private cluster and proves its ready disposition. */
export async function startPrivatePostgresCluster(
  options: StartPrivatePostgresClusterOptions,
): Promise<import("./contracts.js").ReadyPrivatePostgresMechanics> {
  const lifecycleState = createPrivatePostgresLifecycleTracker();
  options.assertControlAuthority();
  assertPrivatePostgresPort(options.expectedIdentity.persistedPort);
  assertLifecycleOptions(options.lifecycle);
  if (!/^\//u.test(options.logFilePath) && process.platform !== "win32") {
    throw controllerProblem(
      "private-postgres.lifecycle.invalid_log_path",
      "Private PostgreSQL log path is not absolute",
      "The PostgreSQL lifecycle log target must be an absolute path under the logical LOG root",
      "validation",
    );
  }
  if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/u.test(options.logFilePath)) {
    throw controllerProblem(
      "private-postgres.lifecycle.invalid_log_path",
      "Private PostgreSQL log path is not absolute",
      "The PostgreSQL lifecycle log target must be an absolute path under the logical LOG root",
      "validation",
    );
  }
  const processOptions = lifecycleProcessOptions({
    ...options,
    persistedPort: options.expectedIdentity.persistedPort,
  });

  try {
    await validateExistingCluster({
      toolchain: options.toolchain,
      placement: options.placement,
      expectedIdentity: options.expectedIdentity,
      timeoutMs: options.lifecycle.startupTimeoutMs,
    });
    const processStatus = await readPrivatePostgresProcessStatus(
      processOptions,
      controllerProblem,
    );
    let startupDisposition: PrivatePostgresStartupDisposition;
    let started: Awaited<ReturnType<typeof validateExistingCluster>>;
    if (processStatus === "RUNNING") {
      await waitForPrivatePostgresReadiness(processOptions, controllerProblem);
      started = await validateExistingCluster({
        toolchain: options.toolchain,
        placement: options.placement,
        expectedIdentity: options.expectedIdentity,
        timeoutMs: options.lifecycle.startupTimeoutMs,
      });
      startupDisposition = "ALREADY_RUNNING";
    } else {
      startupDisposition = "STARTED_BY_THIS_BOOTSTRAP";
      await startProcess(options, lifecycleState);
      lifecycleState.send({ type: "START_COMMAND_SUCCEEDED" });
      await waitForPrivatePostgresReadiness(processOptions, controllerProblem);
      started = await validateExistingCluster({
        toolchain: options.toolchain,
        placement: options.placement,
        expectedIdentity: options.expectedIdentity,
        timeoutMs: options.lifecycle.startupTimeoutMs,
      });
      lifecycleState.send({ type: "READY_PROVEN" });
    }

    return {
      toolchain: started.toolchain,
      placement: started.placement,
      identity: started.identity,
      port: started.port,
      startupDisposition,
      async stop(): Promise<void> {
        options.assertControlAuthority();
        if (startupDisposition === "ALREADY_RUNNING") {
          throw alreadyRunningControlDeniedProblem();
        }
        if (
          lifecycleState.detail === "startCommandPending" ||
          lifecycleState.detail === "startedPendingReady" ||
          lifecycleState.detail === "stopping"
        ) {
          throw controllerProblem(
            "private-postgres.lifecycle.operation_in_progress",
            "Private PostgreSQL lifecycle operation is already in progress",
            `The private PostgreSQL lifecycle cannot stop while it is ${lifecycleState.state}`,
            "conflict",
          );
        }
        await stopWithProof(options, lifecycleState, stopUncertainProblem);
      },
      async restart(): Promise<void> {
        // Intentional duplication: stop and restart share the same control
        // fence but retain operation-specific lifecycle failure messages.
        /* jscpd:ignore-start */
        options.assertControlAuthority();
        if (startupDisposition === "ALREADY_RUNNING") {
          throw alreadyRunningControlDeniedProblem();
        }
        if (
          lifecycleState.detail === "startCommandPending" ||
          lifecycleState.detail === "startedPendingReady" ||
          lifecycleState.detail === "stopping"
        ) {
          throw controllerProblem(
            "private-postgres.lifecycle.operation_in_progress",
            "Private PostgreSQL lifecycle operation is already in progress",
            `The private PostgreSQL lifecycle cannot restart while it is ${lifecycleState.state}`,
            "conflict",
          );
        }
        /* jscpd:ignore-end */
        if (
          lifecycleState.detail === "startOutcomeUncertain" ||
          lifecycleState.detail === "runningObservedUncertain" ||
          lifecycleState.detail === "processUncertain"
        ) {
          throw controllerProblem(
            "private-postgres.lifecycle.restart_uncertain",
            "Private PostgreSQL restart is blocked by uncertain process state",
            "The private PostgreSQL process must first be proven stopped through the bounded stop path",
            "integrity",
          );
        }
        const wasStopped = lifecycleState.detail === "stopped";
        if (!wasStopped) {
          try {
            await assertPrivatePostgresProcessRunning(options);
          } catch (error) {
            if (lifecycleState.can({ type: "UNEXPECTED_PROCESS_EXIT" })) {
              lifecycleState.send({ type: "UNEXPECTED_PROCESS_EXIT" });
            }
            throw error;
          }
        }
        try {
          if (wasStopped) {
            await startProcess(options, lifecycleState);
          } else {
            await restartProcess(options, lifecycleState);
          }
          lifecycleState.send({ type: "START_COMMAND_SUCCEEDED" });
          await waitForPrivatePostgresReadiness(processOptions, controllerProblem);
          const restarted = await validateExistingCluster({
            toolchain: options.toolchain,
            placement: options.placement,
            expectedIdentity: options.expectedIdentity,
            timeoutMs: options.lifecycle.startupTimeoutMs,
          });
          if (
            restarted.identity.clusterSystemIdentifier !==
              started.identity.clusterSystemIdentifier ||
            restarted.port !== started.port
          ) {
            throw controllerProblem(
              "private-postgres.lifecycle.identity_changed",
              "Private PostgreSQL identity changed during restart",
              "The restarted private PostgreSQL process did not preserve the validated cluster identity and port",
              "integrity",
            );
          }
          lifecycleState.send({ type: "READY_PROVEN" });
        } catch (error) {
          const detail: string = lifecycleState.detail;
          if (detail === "startCommandPending") {
            lifecycleState.send({ type: "START_OUTCOME_UNCERTAIN" });
          } else if (detail === "startedPendingReady") {
            lifecycleState.send({ type: "POST_START_PROOF_FAILED" });
          }
          if (error instanceof ProblemError) throw error;
          throw controllerProblem(
            "private-postgres.lifecycle.restart_failed",
            "Private PostgreSQL restart readiness failed",
            "The restarted private PostgreSQL cluster did not return to its validated ready state",
            "unavailable",
          );
        }
      },
    };
  } catch (error) {
    if (lifecycleState.detail === "startCommandPending") {
      lifecycleState.send({ type: "START_OUTCOME_UNCERTAIN" });
      await resolveAmbiguousStartForCleanup(options, lifecycleState);
      throw error;
    } else if (lifecycleState.detail === "startedPendingReady") {
      lifecycleState.send({ type: "POST_START_PROOF_FAILED" });
      await stopWithProof(options, lifecycleState, startCleanupUncertainProblem);
      throw error;
    }
    throw error;
  }
}
