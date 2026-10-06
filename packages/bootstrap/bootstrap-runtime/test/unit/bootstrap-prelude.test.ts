// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asContentDigest,
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  digestCanonicalJson,
  LIFECYCLE_ROOT_IDS,
  type BootId,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import {
  BootstrapOwnerWitnessStore,
  BootstrapStateStore,
  MaintenanceJournalStore,
  maintenanceOperationRef,
  type BootstrapStateBodyV1,
  type MaintenanceJournalBodyV1,
} from "@heptalogos/bootstrap-state";
import { prepareBootstrapPrelude } from "../../src/bootstrap/prelude.js";
import type { BootstrapOwnershipLease } from "../../src/bootstrap/ownership.js";
import { acquireBootstrapOwnership } from "../../src/bootstrap/ownership.js";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";
import type { PrivatePostgresSessionToken } from "../../src/postgres/bootstrap.js";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";

const preparePrivatePostgresForOwnedPreludeMock = vi.hoisted(() =>
  vi.fn(
    async (context: {
      readonly privatePostgresSession: {
        readonly state: string;
        beginPreparation(): PrivatePostgresSessionToken;
        markReady(token: PrivatePostgresSessionToken): void;
        beginStop(token: PrivatePostgresSessionToken): void;
        markQuiescent(token: PrivatePostgresSessionToken): void;
        markUncertain(token: PrivatePostgresSessionToken): void;
      };
    }) => {
      const token = context.privatePostgresSession.beginPreparation();
      context.privatePostgresSession.markReady(token);
      (
        context.privatePostgresSession as typeof context.privatePostgresSession & {
          __testSessionToken?: PrivatePostgresSessionToken;
        }
      ).__testSessionToken = token;
      return {};
    },
  ),
);

vi.mock("../../src/postgres/bootstrap.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/postgres/bootstrap.js")
  >("../../src/postgres/bootstrap.js");
  return {
    ...actual,
    preparePrivatePostgresForOwnedPrelude: preparePrivatePostgresForOwnedPreludeMock,
  };
});

const directories: string[] = [];
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function makeState(revision: number): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision,
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
  };
}

async function makeFixture(
  anchorRoot?: string,
  seedState = true,
): Promise<{
  readonly anchorRoot: string;
  readonly instanceRoot: string;
  readonly locator: BootstrapLocatorV1;
}> {
  const anchor = anchorRoot ?? (await makeDirectory("heptalogos-prelude-anchor-"));
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchor
        : await makeDirectory(`heptalogos-prelude-${id.toLowerCase()}-`);
  }
  const locator: BootstrapLocatorV1 = {
    schemaVersion: 1,
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    roots,
  };
  await writeFile(join(anchor, "heptalogos.bootstrap.json"), JSON.stringify(locator));
  if (seedState) {
    await new BootstrapStateStore(join(roots.INSTANCE, "bootstrap-state")).commit(
      makeState(1),
    );
  }
  return { anchorRoot: anchor, instanceRoot: roots.INSTANCE, locator };
}

async function writeMaintenanceObligation(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  phase: MaintenanceJournalBodyV1["phase"] = "EXECUTING",
): Promise<void> {
  const operationId = createUuidV7Id("MaintenanceOperationId");
  const stateStore = new BootstrapStateStore(
    join(fixture.instanceRoot, "bootstrap-state"),
  );
  const current = await stateStore.load();
  if (current.status !== "CURRENT") throw new Error("expected current BootstrapState");
  await stateStore.commit({
    ...current.value.state,
    revision: current.value.state.revision + 1,
    lastCommittedOperationRef: maintenanceOperationRef(operationId),
  });
  await new MaintenanceJournalStore(fixture.instanceRoot).create({
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
    updatedAt: "2026-08-23T00:00:00.000Z",
  });
}

async function stages(
  journal: Awaited<ReturnType<typeof prepareBootstrapPrelude>>["journal"],
  bootId: BootId,
): Promise<readonly string[]> {
  return (await journal.read(bootId)).map((entry) => entry.stage);
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("pre-PostgreSQL bootstrap prelude", () => {
  it("creates exactly one continuity epoch for an empty logical Instance", async () => {
    const fixture = await makeFixture(undefined, false);
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });
    const seed = makeState(1);

    const initialized = await owned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration: seed.activeBootstrapRuntimeGeneration,
      activeProductGeneration: seed.activeProductGeneration,
    });

    expect(initialized.state.schemaVersion).toBe(1);
    expect(initialized.state.revision).toBe(1);
    expect(initialized.state.continuityEpochId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(owned.state.load()).resolves.toMatchObject({
      status: "CURRENT",
      value: { state: { continuityEpochId: initialized.state.continuityEpochId } },
    });
    await owned.close();
  });

  it("reuses the committed continuity epoch on an ensure retry", async () => {
    const fixture = await makeFixture(undefined, false);
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });
    const commit = vi.spyOn(owned.state, "commit");
    const seed = makeState(1);

    const first = await owned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration: seed.activeBootstrapRuntimeGeneration,
      activeProductGeneration: seed.activeProductGeneration,
    });
    const differentSelection = makeState(2);
    const second = await owned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration:
        differentSelection.activeBootstrapRuntimeGeneration,
      activeProductGeneration: differentSelection.activeProductGeneration,
    });

    expect(second.state.continuityEpochId).toBe(first.state.continuityEpochId);
    expect(second.state.activeProductGeneration).toBe(
      first.state.activeProductGeneration,
    );
    expect(second.state.revision).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
    await owned.close();
  });

  it("reuses the committed continuity epoch after a later boot", async () => {
    const fixture = await makeFixture(undefined, false);
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1000 });
    const seed = makeState(1);
    const first = await firstOwned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration: seed.activeBootstrapRuntimeGeneration,
      activeProductGeneration: seed.activeProductGeneration,
    });
    const firstBootId = firstOwned.bootId;
    await firstOwned.close();

    const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1000 });
    const second = await secondOwned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration: seed.activeBootstrapRuntimeGeneration,
      activeProductGeneration: seed.activeProductGeneration,
    });

    expect(secondOwned.bootId).not.toBe(firstBootId);
    expect(second.state.continuityEpochId).toBe(first.state.continuityEpochId);
    await secondOwned.close();
  });

  it("does not genesis a new epoch from recovered previous state", async () => {
    const fixture = await makeFixture();
    const stateStore = new BootstrapStateStore(
      join(fixture.instanceRoot, "bootstrap-state"),
    );
    await stateStore.commit(makeState(2));
    await writeFile(
      join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
      "corrupt",
    );

    await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.current_authority_required" },
    });
    await expect(stateStore.load()).resolves.toMatchObject({
      status: "RECOVERED_PREVIOUS",
      value: { state: { revision: 1 } },
    });
  });

  it("does not genesis a new epoch from corrupt BootstrapState", async () => {
    const fixture = await makeFixture(undefined, false);
    const stateDirectory = join(fixture.instanceRoot, "bootstrap-state");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, "bootstrap-state.json"), "bad-current");
    await writeFile(
      join(stateDirectory, "bootstrap-state.previous.json"),
      "bad-previous",
    );

    await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.no_valid_revision" },
    });
    await expect(
      readFile(join(stateDirectory, "bootstrap-state.json"), "utf8"),
    ).resolves.toBe("bad-current");
  });

  it("records ordered early stages and reloads authoritative state after ownership", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);

    expect(prepared.installationId).toBe(fixture.locator.installationId);
    expect(prepared.instanceId).toBe(fixture.locator.instanceId);
    expect("preparePrivatePostgres" in prepared).toBe(false);
    expect(prepared.preliminaryState).toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 1 } },
    });
    await expect(stages(prepared.journal, prepared.bootId)).resolves.toEqual([
      "bootstrap.prelude.started",
      "bootstrap.locator.resolved",
      "bootstrap.roots.resolved",
      "bootstrap.state.preliminary_read",
    ]);

    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });
    expect("preparePrivatePostgres" in owned).toBe(true);
    expect(owned.authoritativeState).toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 1 } },
    });
    await owned.state.commit(makeState(2));
    await owned.close();

    await expect(stages(prepared.journal, prepared.bootId)).resolves.toEqual([
      "bootstrap.prelude.started",
      "bootstrap.locator.resolved",
      "bootstrap.roots.resolved",
      "bootstrap.state.preliminary_read",
      "bootstrap.ownership.acquired",
      "bootstrap.state.authoritative_reload",
      "bootstrap.prelude.owned",
      "bootstrap.prelude.released",
    ]);
  });

  it("blocks normal bootstrap when only RECOVERED_PREVIOUS state is available", async () => {
    const fixture = await makeFixture();
    const stateStore = new BootstrapStateStore(
      join(fixture.instanceRoot, "bootstrap-state"),
    );
    await stateStore.commit(makeState(2));
    await writeFile(
      join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
      "corrupt",
    );

    await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.current_authority_required" },
    });
  });

  it("fails closed when a normal bootstrap required root is unavailable", async () => {
    const fixture = await makeFixture();
    const roots = {
      ...fixture.locator.roots,
      DATA: join(tmpdir(), "heptalogos-unavailable-prelude-data"),
    };
    await writeFile(
      join(fixture.anchorRoot, "heptalogos.bootstrap.json"),
      JSON.stringify({ ...fixture.locator, roots }),
    );

    await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.root.not_found" },
    });
  });

  it("blocks normal bootstrap on an incomplete maintenance obligation before ownership", async () => {
    const fixture = await makeFixture();
    await writeMaintenanceObligation(fixture);

    await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.maintenance_required" },
    });
    await expect(
      lstat(join(fixture.instanceRoot, LOCK_DIRECTORY)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rechecks the maintenance obligation after acquiring ownership", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    await writeMaintenanceObligation(fixture);

    await expect(
      prepared.acquireOwnership({ heartbeatMs: 1_000 }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.maintenance_required" },
    });
    await expect(
      lstat(join(fixture.instanceRoot, LOCK_DIRECTORY)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("allows normal bootstrap after SUCCEEDED maintenance", async () => {
    const fixture = await makeFixture();
    await writeMaintenanceObligation(fixture, "SUCCEEDED");

    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    await owned.close();
  });

  it("allows normal bootstrap after ABORTED maintenance", async () => {
    const fixture = await makeFixture();
    await writeMaintenanceObligation(fixture, "ABORTED");

    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    await owned.close();
  });

  it.each(["PREPARED", "EXECUTING", "RECOVERY_REQUIRED"] as const)(
    "blocks normal bootstrap for incomplete phase %s",
    async (phase) => {
      const fixture = await makeFixture();
      await writeMaintenanceObligation(fixture, phase);

      await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.recovery.maintenance_required" },
      });
    },
  );

  it("blocks owned authoritative reload when only RECOVERED_PREVIOUS state is available", async () => {
    const fixture = await makeFixture();
    const stateStore = new BootstrapStateStore(
      join(fixture.instanceRoot, "bootstrap-state"),
    );
    await stateStore.commit(makeState(2));
    await writeFile(
      join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
      "corrupt",
    );
    const profile = await resolveBootstrapPathProfile(fixture.locator, ["INSTANCE"]);
    const ownership = await acquireBootstrapOwnership(profile.resolve("INSTANCE"), {
      heartbeatMs: 1000,
      bootId: createBootId(),
    });
    const preludeModule = (await import("../../src/bootstrap/prelude.js")) as Record<
      string,
      unknown
    >;
    const adopt = preludeModule.adoptRecoveredBootstrapOwnershipForPrelude as (
      anchorRoot: string,
      lease: BootstrapOwnershipLease,
      identity: { bootId: BootId; bootstrapActivityId: string },
    ) => Promise<unknown>;

    await expect(
      adopt(fixture.anchorRoot, ownership, {
        bootId: createBootId(),
        bootstrapActivityId: createUuidV7Id("ActivityId"),
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.current_authority_required" },
    });
    expect(ownership.state).toBe("RELEASED");
  });

  it("materializes one normal owned prelude from one held ownership generation", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const ownershipWitnesses = new BootstrapOwnerWitnessStore(fixture.instanceRoot);

    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });
    const ownerBeforeClose = await ownershipWitnesses.readOwner();
    expect(ownerBeforeClose?.witness.bootId).toBe(prepared.bootId);
    expect(owned.ownershipState).toBe("HELD");
    expect(owned.authoritativeState).toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 1 } },
    });

    await owned.close();

    await expect(ownershipWitnesses.readOwner()).resolves.toBeUndefined();
    expect(owned.ownershipState).toBe("RELEASED");
  });

  it("adopts a held lease without creating a second owner generation", async () => {
    const fixture = await makeFixture();
    const profile = await resolveBootstrapPathProfile(fixture.locator, ["INSTANCE"]);
    const recoveryBootId = createBootId();
    const bootstrapActivityId = createUuidV7Id("ActivityId");
    const ownership = await acquireBootstrapOwnership(profile.resolve("INSTANCE"), {
      heartbeatMs: 1000,
      bootId: recoveryBootId,
    });
    const witnesses = new BootstrapOwnerWitnessStore(fixture.instanceRoot);
    const ownerBefore = await witnesses.readOwner();

    const preludeModule = (await import("../../src/bootstrap/prelude.js")) as Record<
      string,
      unknown
    >;
    expect(typeof preludeModule.adoptRecoveredBootstrapOwnershipForPrelude).toBe(
      "function",
    );
    if (
      typeof preludeModule.adoptRecoveredBootstrapOwnershipForPrelude !== "function"
    ) {
      await ownership.release();
      return;
    }
    const adopt = preludeModule.adoptRecoveredBootstrapOwnershipForPrelude as (
      anchorRoot: string,
      lease: BootstrapOwnershipLease,
      identity: { bootId: BootId; bootstrapActivityId: string },
    ) => Promise<{ ownershipState: string; close(): Promise<void> }>;
    const owned = await adopt(fixture.anchorRoot, ownership, {
      bootId: recoveryBootId,
      bootstrapActivityId,
    });
    const ownerAfter = await witnesses.readOwner();

    expect(ownerAfter?.witness.lockGenerationId).toBe(
      ownerBefore?.witness.lockGenerationId,
    );
    expect(await witnesses.listAttempts()).toHaveLength(0);
    expect(await witnesses.listReleasing()).toHaveLength(0);
    expect(owned.ownershipState).toBe("HELD");

    await owned.close();
    await expect(witnesses.readOwner()).resolves.toBeUndefined();
  });

  it("rejects recovered-lease adoption when the held lease belongs to another root", async () => {
    const heldFixture = await makeFixture();
    const requestedFixture = await makeFixture();
    const profile = await resolveBootstrapPathProfile(heldFixture.locator, [
      "INSTANCE",
    ]);
    const ownership = await acquireBootstrapOwnership(profile.resolve("INSTANCE"), {
      heartbeatMs: 1000,
      bootId: createBootId(),
    });
    const preludeModule = (await import("../../src/bootstrap/prelude.js")) as Record<
      string,
      unknown
    >;
    expect(typeof preludeModule.adoptRecoveredBootstrapOwnershipForPrelude).toBe(
      "function",
    );
    if (
      typeof preludeModule.adoptRecoveredBootstrapOwnershipForPrelude !== "function"
    ) {
      await ownership.release();
      return;
    }
    const adopt = preludeModule.adoptRecoveredBootstrapOwnershipForPrelude as (
      anchorRoot: string,
      lease: BootstrapOwnershipLease,
      identity: { bootId: BootId; bootstrapActivityId: string },
    ) => Promise<unknown>;

    await expect(
      adopt(requestedFixture.anchorRoot, ownership, {
        bootId: createBootId(),
        bootstrapActivityId: createUuidV7Id("ActivityId"),
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.scope_mismatch" },
    });
    expect(ownership.state).toBe("RELEASED");
  });

  it("allows competing attempts to keep separate journals while only one mutates state", async () => {
    const fixture = await makeFixture();
    const first = await prepareBootstrapPrelude(fixture.anchorRoot);
    const second = await prepareBootstrapPrelude(fixture.anchorRoot);
    const before = await readFile(
      join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
      "utf8",
    );

    const results = await Promise.allSettled([
      first.acquireOwnership({ heartbeatMs: 1000 }),
      second.acquireOwnership({ heartbeatMs: 1000 }),
    ]);
    const ownedResult = results.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof first.acquireOwnership>>
      > => result.status === "fulfilled",
    );
    const blockedResult = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(ownedResult).toBeDefined();
    expect(blockedResult).toMatchObject({
      reason: { problem: { problemCode: "bootstrap.ownership.lock_present" } },
    });
    expect(
      await readFile(
        join(fixture.instanceRoot, "bootstrap-state", "bootstrap-state.json"),
        "utf8",
      ),
    ).toBe(before);
    const firstStages = await stages(first.journal, first.bootId);
    const secondStages = await stages(second.journal, second.bootId);
    expect(
      [firstStages, secondStages].filter((value) =>
        value.includes("bootstrap.ownership.blocked"),
      ),
    ).toHaveLength(1);

    await ownedResult?.value.close();
  });

  it("allows concurrent owners for different resolved instance roots", async () => {
    const anchor = await makeDirectory("heptalogos-prelude-shared-program-");
    const first = await makeFixture(anchor);
    const firstPrepared = await prepareBootstrapPrelude(first.anchorRoot);
    const second = await makeFixture(anchor);
    const secondPrepared = await prepareBootstrapPrelude(second.anchorRoot);
    const [firstOwned, secondOwned] = await Promise.all([
      firstPrepared.acquireOwnership({ heartbeatMs: 1000 }),
      secondPrepared.acquireOwnership({ heartbeatMs: 1000 }),
    ]);

    expect(first.instanceRoot).not.toBe(second.instanceRoot);
    expect(firstOwned.instanceId).not.toBe(secondOwned.instanceId);
    await Promise.all([firstOwned.close(), secondOwned.close()]);
  });

  it("blocks close while private PostgreSQL is ready and retries after a clean stop", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });

    await owned.preparePrivatePostgres({} as never);

    await expect(owned.close()).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.private_postgres.release_blocked" },
    });
    expect(owned.ownershipState).toBe("HELD");

    const context = preparePrivatePostgresForOwnedPreludeMock.mock.calls.at(-1)?.[0];
    expect(context).toBeDefined();
    if (context === undefined)
      throw new Error("Private PostgreSQL context was not prepared");
    const token = (
      context.privatePostgresSession as unknown as {
        __testSessionToken?: PrivatePostgresSessionToken;
      }
    ).__testSessionToken;
    context.privatePostgresSession.beginStop(token as PrivatePostgresSessionToken);
    context.privatePostgresSession.markQuiescent(token as PrivatePostgresSessionToken);

    await expect(owned.close()).resolves.toBeUndefined();
    expect(owned.ownershipState).toBe("RELEASED");
  });

  it("does not expose a raw ownership release capability from an owned prelude", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });
    const view = owned as unknown as {
      readonly ownershipState: string;
      readonly ownershipSignal: AbortSignal;
    };

    expect("ownership" in owned).toBe(false);
    expect(view.ownershipState).toBe("HELD");
    expect(view.ownershipSignal.aborted).toBe(false);
    await owned.close();
  });

  it.each([
    [
      "TRANSITIONING",
      (session: {
        beginStop(token: PrivatePostgresSessionToken): void;
        __testSessionToken?: PrivatePostgresSessionToken;
      }) =>
        session.beginStop(session.__testSessionToken as PrivatePostgresSessionToken),
    ],
    [
      "UNCERTAIN",
      (session: {
        beginStop(token: PrivatePostgresSessionToken): void;
        markUncertain(token: PrivatePostgresSessionToken): void;
        __testSessionToken?: PrivatePostgresSessionToken;
      }) => {
        const token = session.__testSessionToken as PrivatePostgresSessionToken;
        session.beginStop(token);
        session.markUncertain(token);
      },
    ],
  ] as const)(
    "blocks close while private PostgreSQL is %s",
    async (_state, arrange) => {
      const fixture = await makeFixture();
      const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const owned = await prepared.acquireOwnership({ heartbeatMs: 1000 });

      await owned.preparePrivatePostgres({} as never);
      const context = preparePrivatePostgresForOwnedPreludeMock.mock.calls.at(-1)?.[0];
      expect(context).toBeDefined();
      arrange(context!.privatePostgresSession);
      await expect(owned.close()).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.private_postgres.release_blocked" },
      });
      expect(owned.ownershipState).toBe("HELD");
      if (context!.privatePostgresSession.state === "UNCERTAIN") {
        const token = (
          context!.privatePostgresSession as unknown as {
            __testSessionToken?: PrivatePostgresSessionToken;
          }
        ).__testSessionToken as PrivatePostgresSessionToken;
        context!.privatePostgresSession.beginStop(token);
      }
      const token = (
        context!.privatePostgresSession as unknown as {
          __testSessionToken?: PrivatePostgresSessionToken;
        }
      ).__testSessionToken as PrivatePostgresSessionToken;
      context!.privatePostgresSession.markQuiescent(token);
      await owned.close();
    },
  );

  it("does not reclaim an abandoned lock at prelude level", async () => {
    const fixture = await makeFixture();
    const lockDirectory = join(fixture.instanceRoot, LOCK_DIRECTORY);
    await mkdir(lockDirectory);
    await utimes(lockDirectory, new Date(0), new Date(0));

    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    await expect(
      prepared.acquireOwnership({ heartbeatMs: 1000 }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.lock_present" },
    });
    await expect(lstat(lockDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stages(prepared.journal, prepared.bootId)).resolves.toContain(
      "bootstrap.ownership.blocked",
    );
  });
});
