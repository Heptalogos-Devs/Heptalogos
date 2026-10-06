// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { parseRecoveryMaintenanceProcessArgs } from "./recovery-maintenance-process-args.mjs";

const require = createRequire(import.meta.url);
const {
  BootstrapStateStore,
  parseMaintenanceJournal,
} = require("@heptalogos/bootstrap-state");
const {
  loadBootstrapLocator,
  prepareBootstrapPrelude,
  proveLocalInstallationOwner,
  resolveBootstrapPathProfile,
} = require("@heptalogos/bootstrap-runtime");
const {
  recoverInterruptedHostMaintenance,
} = require("../../../dist/maintenance/recovery.js");
const {
  resolvePrivatePostgresPlacement,
  resolvePrivatePostgresToolchain,
} = require("@heptalogos/private-postgres");

const { anchorRoot, role, pgBin, portText, operationIdText, targetPhase } =
  parseRecoveryMaintenanceProcessArgs(process.argv.slice(2));

const LIFECYCLE = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
};
const HOST_TIMING = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
};

function send(message, callback) {
  if (typeof process.send !== "function") {
    callback?.();
    return;
  }
  process.send(message, callback);
}

const releaseRequested = new Promise((resolve) => {
  process.on("message", (message) => {
    if (message?.type === "release") resolve();
  });
});

function keyProvider() {
  return {
    async withPrivatePostgresBootstrapPassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_BOOTSTRAP_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresHostLeasePassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_HOST_LEASE_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresRuntimePassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_RUNTIME_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresMigrationPassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_MIGRATION_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresDurableExecutionPassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_DURABLE_EXECUTION_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
}

function retirement() {
  return {
    async retire() {
      // This child intentionally composes no product Runtime.
    },
  };
}

async function watchJournalPhase(instanceRoot, operationId, phase) {
  const currentPath = join(
    instanceRoot,
    "maintenance-journal",
    operationId,
    "maintenance-state.json",
  );
  let stopped = false;
  const timer = setInterval(() => {
    void (async () => {
      if (stopped) return;
      try {
        const parsed = parseMaintenanceJournal(await readFile(currentPath, "utf8"));
        if (parsed.ok && parsed.value.state.phase === phase) {
          stopped = true;
          clearInterval(timer);
          send({ type: "durable-phase", operationId, phase }, () =>
            process.kill(process.pid, "SIGSTOP"),
          );
        }
      } catch {
        // The parent independently adjudicates the journal; transient reads retry.
      }
    })();
  }, 10);
  return () => clearInterval(timer);
}

async function descriptorForRecovery(anchor, binDirectory, port) {
  const locator = await loadBootstrapLocator(anchor);
  const profile = await resolveBootstrapPathProfile(locator, [
    "INSTANCE",
    "DATA",
    "LOG",
  ]);
  const loaded = await new BootstrapStateStore(
    join(profile.resolve("INSTANCE").canonicalPath, "bootstrap-state"),
  ).load();
  const persisted =
    loaded.status === "CURRENT" ? loaded.value.state.privatePostgres : undefined;
  if (
    loaded.status !== "CURRENT" ||
    loaded.value.state.schemaVersion !== 1 ||
    persisted === undefined ||
    persisted.schemaVersion !== 1
  ) {
    throw new Error("recovery child requires canonical BootstrapState V1");
  }
  const toolchain = await resolvePrivatePostgresToolchain(binDirectory);
  const placement = resolvePrivatePostgresPlacement(
    profile.resolve("DATA").canonicalPath,
  );
  return {
    toolchain,
    placement,
    expectedIdentity: {
      installationId: persisted.installationId,
      instanceId: persisted.instanceId,
      postgresMajor: persisted.postgresMajor,
      bootstrapRoleName: persisted.bootstrapRoleName,
      placement: persisted.dataPlacement,
      persistedPort: Number(port),
      clusterSystemIdentifier: persisted.clusterSystemIdentifier,
      initializationProfileRevision: persisted.initializationProfileRevision,
    },
    logFilePath: join(profile.resolve("LOG").canonicalPath, "private-postgres.log"),
    lifecycle: LIFECYCLE,
  };
}

async function runMaintenance() {
  const prepared = await prepareBootstrapPrelude(anchorRoot);
  const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
  const ready = await owned.preparePrivatePostgres({
    toolchainBinDirectory: pgBin,
    initialPort: Number(portText),
    lifecycle: LIFECYCLE,
    keyProvider: keyProvider(),
  });
  const host = await owned.handoffPrivatePostgresToHost(ready, {
    initializeCanonicalHost: async ({ authority }) => {
      authority.assertCurrent();
    },
    keyProvider: keyProvider(),
    timing: HOST_TIMING,
  });
  const maintenance = await host.preparePrivatePostgresMaintenance({
    kind: "RESTART_PRIVATE_POSTGRES",
  });
  const profile = await resolveBootstrapPathProfile(
    await loadBootstrapLocator(anchorRoot),
    ["INSTANCE"],
  );
  send({
    type: "maintenance-prepared",
    operationId: maintenance.operationId,
    sourceToken: host.token,
    clusterSystemIdentifier: ready.clusterSystemIdentifier,
  });
  if (role === "maintenance-prepared") {
    await releaseRequested;
    return;
  }
  const stopWatching = await watchJournalPhase(
    profile.resolve("INSTANCE").canonicalPath,
    maintenance.operationId,
    targetPhase,
  );
  try {
    const result = await maintenance.execute(retirement());
    stopWatching();
    send({ type: "completed", kind: result.kind });
    if (result.kind === "RESTARTED") {
      await releaseRequested;
      await result.host.shutdownKeepingPrivatePostgres(retirement());
      send({ type: "released" });
    }
  } finally {
    stopWatching();
  }
}

async function runRecovery() {
  const locator = await loadBootstrapLocator(anchorRoot);
  const profile = await resolveBootstrapPathProfile(locator, ["INSTANCE"]);
  const operationId = operationIdText;
  const descriptor = await descriptorForRecovery(anchorRoot, pgBin, portText);
  send({ type: "recovery-started", operationId });
  const stopWatching =
    targetPhase === undefined
      ? () => {}
      : await watchJournalPhase(
          profile.resolve("INSTANCE").canonicalPath,
          operationId,
          targetPhase,
        );
  try {
    const result = await recoverInterruptedHostMaintenance({
      anchorRoot,
      principal: await proveLocalInstallationOwner(anchorRoot),
      expectedOperationId: operationId,
      initializeCanonicalHost: async ({ authority }) => {
        authority.assertCurrent();
      },
      keyProvider: keyProvider(),
      timing: HOST_TIMING,
      privatePostgres: descriptor,
    });
    stopWatching();
    send({
      type: "completed",
      kind: result.kind,
      token: result.kind === "RESTARTED" ? result.host.token : undefined,
    });
    if (result.kind === "RESTARTED") {
      await releaseRequested;
      await result.host.shutdownKeepingPrivatePostgres(retirement());
      send({ type: "released" });
    }
  } finally {
    stopWatching();
  }
}

try {
  if (role === "maintenance" || role === "maintenance-prepared") await runMaintenance();
  else if (role === "recovery" || role === "recovery-complete") await runRecovery();
  else throw new Error(`unsupported role ${role}`);
} catch (error) {
  send({
    type: "error",
    problemCode: error?.problem?.problemCode ?? "UNKNOWN",
    message: String(error),
  });
  setTimeout(() => process.exit(1), 20).unref();
}
