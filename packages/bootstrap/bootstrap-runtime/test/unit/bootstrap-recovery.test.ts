// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  createBootId,
  createHostOwnershipToken,
  createUuidV7Id,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import {
  BootstrapOwnerWitnessStore,
  BootstrapStateStore,
  createBootstrapLockGenerationId,
  MaintenanceJournalStore,
  maintenanceOperationRef,
  type BootstrapStateBodyV1,
  type MaintenanceJournalBodyV1,
} from "@heptalogos/bootstrap-state";
import { currentBootstrapProcessIdentity } from "../../src/bootstrap/process-identity.js";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";
import { loadBootstrapLocator } from "../../src/bootstrap/locator.js";
import {
  inspectBootstrapRecovery,
  reclaimAbandonedBootstrapOwnership,
  type BootstrapRecoveryDisposition,
} from "../../src/recovery/bootstrap.js";
import { proveLocalInstallationOwner } from "../../src/bootstrap/local-installation-owner.js";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";

const directories: string[] = [];
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const PROCESS_INSPECTION_TEST_TIMEOUT_MS = 30_000;

async function makeFixture() {
  const anchorRoot = await mkdtemp(join(tmpdir(), "heptalogos-recovery-inspect-"));
  directories.push(anchorRoot);
  const roots = {
    PROGRAM: anchorRoot,
    INSTANCE: await mkdtemp(join(tmpdir(), "heptalogos-inspect-instance-")),
    CONFIGURATION: await mkdtemp(join(tmpdir(), "heptalogos-inspect-configuration-")),
    DATA: await mkdtemp(join(tmpdir(), "heptalogos-inspect-data-")),
    SECRET: await mkdtemp(join(tmpdir(), "heptalogos-inspect-secret-")),
    BLOB: await mkdtemp(join(tmpdir(), "heptalogos-inspect-blob-")),
    BACKUP: await mkdtemp(join(tmpdir(), "heptalogos-inspect-backup-")),
    LOG: await mkdtemp(join(tmpdir(), "heptalogos-inspect-log-")),
    CACHE: await mkdtemp(join(tmpdir(), "heptalogos-inspect-cache-")),
    TEMP: await mkdtemp(join(tmpdir(), "heptalogos-inspect-temp-")),
    RUN: await mkdtemp(join(tmpdir(), "heptalogos-inspect-run-")),
    PACKAGE_STAGING: await mkdtemp(
      join(tmpdir(), "heptalogos-inspect-package-staging-"),
    ),
  } as const;
  directories.push(...Object.values(roots).filter((root) => root !== anchorRoot));
  const locator: BootstrapLocatorV1 = {
    schemaVersion: 1,
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    roots,
  };
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify(locator),
  );
  return { anchorRoot, locator, instanceRoot: roots.INSTANCE };
}

async function makeLock(instanceRoot: string, ageMs: number): Promise<string> {
  const lock = join(instanceRoot, LOCK_DIRECTORY);
  await mkdir(lock);
  const at = new Date(Date.now() - ageMs);
  await utimes(lock, at, at);
  return lock;
}

async function writeMaintenancePointer(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  phase: "EXECUTING" | "SUCCEEDED" = "EXECUTING",
): Promise<void> {
  const operationId = createUuidV7Id("MaintenanceOperationId");
  const state: BootstrapStateBodyV1 = {
    schemaVersion: 1,
    revision: 1,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId:
      "0197cfe0-0000-7000-8000-000000000001" as BootstrapStateBodyV1["continuityEpochId"],
    lastCommittedOperationRef: maintenanceOperationRef(operationId),
  };
  const body: MaintenanceJournalBodyV1 = {
    schemaVersion: 1,
    revision: 1,
    operationId,
    activityId: createUuidV7Id("ActivityId"),
    installationId: fixture.locator.installationId,
    instanceId: fixture.locator.instanceId,
    operationType: "PRIVATE_POSTGRES_STOP",
    source: {
      hostOwnershipToken: createHostOwnershipToken(),
      hostBootId: createBootId(),
      hostOwnershipRevision: "7",
      postgresClusterSystemIdentifier: "123",
      persistedPort: 55432,
    },
    target: { privatePostgres: "STOPPED" },
    phase,
    updatedAt: "2026-08-22T08:30:00.000Z",
  };
  await new BootstrapStateStore(join(fixture.instanceRoot, "bootstrap-state")).commit(
    state,
  );
  await new MaintenanceJournalStore(fixture.instanceRoot).create(body);
}

async function expectDisposition(
  anchorRoot: string,
  disposition: BootstrapRecoveryDisposition,
) {
  const locator = await loadBootstrapLocator(anchorRoot);
  const paths = await resolveBootstrapPathProfile(locator, ["INSTANCE"]);
  const instanceRoot = paths.resolve("INSTANCE").canonicalPath;
  const before = await snapshotInstanceRoot(instanceRoot);
  const inspection = await inspectBootstrapRecovery(anchorRoot);
  expect(inspection.disposition).toBe(disposition);
  await expect(snapshotInstanceRoot(instanceRoot)).resolves.toEqual(before);
  return inspection;
}

async function snapshotInstanceRoot(
  instanceRoot: string,
): Promise<readonly [string, unknown][]> {
  const entries: Array<[string, unknown]> = [];
  async function visit(path: string, relativePath: string): Promise<void> {
    const metadata = await lstat(path);
    const key = relativePath.length === 0 ? "." : relativePath;
    if (metadata.isDirectory()) {
      entries.push([
        key,
        { kind: "directory", mtimeMs: metadata.mtimeMs, size: metadata.size },
      ]);
      const children = await readdir(path);
      for (const child of children.sort()) {
        await visit(
          join(path, child),
          relativePath.length === 0 ? child : join(relativePath, child),
        );
      }
      return;
    }
    if (metadata.isFile()) {
      entries.push([
        key,
        {
          kind: "file",
          contents: (await readFile(path)).toString("base64"),
          mtimeMs: metadata.mtimeMs,
          size: metadata.size,
        },
      ]);
      return;
    }
    entries.push([
      key,
      { kind: "other", mtimeMs: metadata.mtimeMs, size: metadata.size },
    ]);
  }
  await visit(instanceRoot, "");
  return entries;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("bounded bootstrap recovery inspection", () => {
  it("reports NO_RECOVERY_REQUIRED when no lock or incomplete operation exists", async () => {
    const fixture = await makeFixture();

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "NO_RECOVERY_REQUIRED",
    );
    expect(inspection.maintenanceIncomplete).toBe(false);
  });

  it("ignores unavailable unrelated roots during read-only recovery inspection", async () => {
    const fixture = await makeFixture();
    const roots = {
      ...fixture.locator.roots,
      BACKUP: join(tmpdir(), "heptalogos-unavailable-inspect-backup"),
      CACHE: join(tmpdir(), "heptalogos-unavailable-inspect-cache"),
      PACKAGE_STAGING: join(tmpdir(), "heptalogos-unavailable-inspect-package-staging"),
    };
    await writeFile(
      join(fixture.anchorRoot, "heptalogos.bootstrap.json"),
      JSON.stringify({ ...fixture.locator, roots }),
    );

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "NO_RECOVERY_REQUIRED",
    );

    expect(inspection.problem).toBeUndefined();
  });

  it("does not treat a dead historical ATTEMPT as ownership when no lock exists", async () => {
    const fixture = await makeFixture();
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "NO_RECOVERY_REQUIRED",
    );
    expect(inspection.attemptProcessStatuses).toContain("PROCESS_DEAD");
  });

  it("does not treat a dead historical OWNER as ownership when no lock exists", async () => {
    const fixture = await makeFixture();
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishOwner({
      schemaVersion: 1,
      phase: "OWNER",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "NO_RECOVERY_REQUIRED",
    );
    expect(inspection.ownerProcessStatus).toBe("PROCESS_DEAD");
  });

  it("routes no-lock incomplete maintenance even with dead historical OWNER evidence", async () => {
    const fixture = await makeFixture();
    await writeMaintenancePointer(fixture);
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishOwner({
      schemaVersion: 1,
      phase: "OWNER",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    await expectDisposition(fixture.anchorRoot, "INCOMPLETE_MAINTENANCE");
  });

  it(
    "blocks no-lock inspection when an OWNER witness proves this process",
    async () => {
      const fixture = await makeFixture();
      const identity = currentBootstrapProcessIdentity();
      await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishOwner({
        schemaVersion: 1,
        phase: "OWNER",
        lockGenerationId: createBootstrapLockGenerationId(),
        bootId: createBootId(),
        pid: identity.pid,
        processStartedAtMs: identity.startedAtMs,
        heartbeatMs: 1_000,
        createdAt: new Date().toISOString(),
      });

      const inspection = await expectDisposition(fixture.anchorRoot, "BLOCKED");
      expect(inspection.ownerProcessStatus).toBe("SAME_PROCESS");
    },
    PROCESS_INSPECTION_TEST_TIMEOUT_MS,
  );

  it("reports RECOVERED_PREVIOUS as blocked inspection evidence without a recovery decision", async () => {
    const fixture = await makeFixture();
    await writeMaintenancePointer(fixture);
    const stateStore = new BootstrapStateStore(
      join(fixture.instanceRoot, "bootstrap-state"),
    );
    const current = await stateStore.load();
    if (current.status !== "CURRENT")
      throw new Error("expected current BootstrapState");
    await stateStore.commit({ ...current.value.state, revision: 2 });
    await writeFile(
      join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
      "corrupt",
    );
    const before = await snapshotInstanceRoot(fixture.instanceRoot);

    const inspection = await inspectBootstrapRecovery(fixture.anchorRoot);

    expect(inspection.disposition).toBe("BLOCKED");
    expect(inspection.bootstrapState).toMatchObject({
      status: "RECOVERED_PREVIOUS",
      value: { state: { revision: 1 } },
      problem: { problemCode: "bootstrap.state.current_corrupt" },
    });
    expect(inspection.problem).toMatchObject({
      problemCode: "bootstrap.state.current_authority_required",
    });
    await expect(snapshotInstanceRoot(fixture.instanceRoot)).resolves.toEqual(before);
  });

  it("reports ABANDONED_OWNER_ELIGIBLE only for stale lock plus dead evidence", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    const witnessStore = new BootstrapOwnerWitnessStore(fixture.instanceRoot);
    await witnessStore.createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "ABANDONED_OWNER_ELIGIBLE",
    );
    expect(inspection.attemptProcessStatuses).toContain("PROCESS_DEAD");
    expect(inspection.maintenanceIncomplete).toBe(false);
  });

  it("reports abandoned ownership with an incomplete maintenance pointer", async () => {
    const fixture = await makeFixture();
    await writeMaintenancePointer(fixture);
    await makeLock(fixture.instanceRoot, 31_000);
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "ABANDONED_OWNER_ELIGIBLE",
    );
    expect(inspection.maintenanceIncomplete).toBe(true);
    expect(inspection.operationId).toBeDefined();
  });

  it("reports a completed historical operation as not maintenance-incomplete", async () => {
    const fixture = await makeFixture();
    await writeMaintenancePointer(fixture, "SUCCEEDED");
    await makeLock(fixture.instanceRoot, 31_000);
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "ABANDONED_OWNER_ELIGIBLE",
    );
    expect(inspection.maintenanceIncomplete).toBe(false);
  });

  it("reports INCOMPLETE_MAINTENANCE without a bootstrap lock", async () => {
    const fixture = await makeFixture();
    await writeMaintenancePointer(fixture);

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "INCOMPLETE_MAINTENANCE",
    );
    expect(inspection.maintenanceIncomplete).toBe(true);
  });

  it("uses dead RELEASING evidence to explain a stale lock", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishReleasing({
      schemaVersion: 1,
      phase: "RELEASING",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "ABANDONED_OWNER_ELIGIBLE",
    );
    expect(inspection.releasing).toHaveLength(1);
    expect(inspection.releasingProcessStatuses).toContain("PROCESS_DEAD");
  });

  it("does not treat an orphan RELEASING witness as recovery ownership without a lock", async () => {
    const fixture = await makeFixture();
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishReleasing({
      schemaVersion: 1,
      phase: "RELEASING",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "NO_RECOVERY_REQUIRED",
    );
    expect(inspection.releasing).toHaveLength(1);
  });

  it("does not let historical RELEASING evidence override a current owner witness", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    const identity = currentBootstrapProcessIdentity();
    const store = new BootstrapOwnerWitnessStore(fixture.instanceRoot);
    await store.publishOwner({
      schemaVersion: 1,
      phase: "OWNER",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });
    await store.publishReleasing({
      schemaVersion: 1,
      phase: "RELEASING",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: identity.pid,
      processStartedAtMs: identity.startedAtMs,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    await expectDisposition(fixture.anchorRoot, "ABANDONED_OWNER_ELIGIBLE");
  }, 15_000);

  it("reports ACTIVE_BOOTSTRAP_OWNER for a live owner witness", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    const identity = currentBootstrapProcessIdentity();
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishOwner({
      schemaVersion: 1,
      phase: "OWNER",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: identity.pid,
      processStartedAtMs: identity.startedAtMs,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(
      fixture.anchorRoot,
      "ACTIVE_BOOTSTRAP_OWNER",
    );
    expect(inspection.ownerProcessStatus).toBe("SAME_PROCESS");
  });

  it("blocks a fresh lock even when its witness process is dead", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 1_000);
    const witnessStore = new BootstrapOwnerWitnessStore(fixture.instanceRoot);
    await witnessStore.createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    await expectDisposition(fixture.anchorRoot, "BLOCKED");
  });

  it("blocks a stale lock when process identity is ambiguous", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    const identity = currentBootstrapProcessIdentity();
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).publishOwner({
      schemaVersion: 1,
      phase: "OWNER",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: identity.pid,
      processStartedAtMs: identity.startedAtMs - 10_000,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const inspection = await expectDisposition(fixture.anchorRoot, "BLOCKED");
    expect(inspection.ownerProcessStatus).toBe("UNKNOWN");
  });

  it("blocks corrupt owner evidence", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    await writeFile(
      join(fixture.instanceRoot, ".heptalogos-bootstrap-owner.json"),
      "corrupt",
    );

    await expectDisposition(fixture.anchorRoot, "BLOCKED");
  });

  it("blocks stale ownership when no owner or attempt evidence proves death", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);

    await expectDisposition(fixture.anchorRoot, "BLOCKED");
  });

  it("reclaims only after authentic local-owner proof and rechecks the lease", async () => {
    const fixture = await makeFixture();
    await makeLock(fixture.instanceRoot, 31_000);
    await new BootstrapOwnerWitnessStore(fixture.instanceRoot).createAttempt({
      schemaVersion: 1,
      phase: "ATTEMPT",
      lockGenerationId: createBootstrapLockGenerationId(),
      bootId: createBootId(),
      pid: 999_999,
      processStartedAtMs: 0,
      heartbeatMs: 1_000,
      createdAt: new Date().toISOString(),
    });

    const principal = await proveLocalInstallationOwner(fixture.anchorRoot);
    const bootId = createBootId();
    const lease = await reclaimAbandonedBootstrapOwnership(
      fixture.anchorRoot,
      principal,
      { heartbeatMs: 1_000, bootId },
    );

    expect(lease.state).toBe("HELD");
    await expect(
      new BootstrapOwnerWitnessStore(fixture.instanceRoot).readOwner(),
    ).resolves.toMatchObject({ witness: { phase: "OWNER", bootId } });
    await lease.release();
  });
});
