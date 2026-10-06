// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBootId,
  createInstallationId,
  createInstanceId,
  isUuidV7,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import type { BootstrapKeyRequestContext } from "../../src/bootstrap/key-provider.js";
import { createPrivatePostgresSessionTracker } from "../../src/postgres/bootstrap.js";
import {
  handoffPrivatePostgresToHostForOwnedPrelude,
  type OwnedBootstrapPreludeHandoffContext,
  type HostOwnershipHandoffOptions,
} from "../../src/host/handoff.js";
import type { ReadyPrivatePostgres } from "../../src/postgres/bootstrap.js";

const hostOwnershipMocks = vi.hoisted(() => ({
  provision: vi.fn(),
  inspect: vi.fn(),
  reserve: vi.fn(),
  schema: vi.fn(),
  acquireLease: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@heptalogos/host-ownership", async () => {
  const actual = await vi.importActual<typeof import("@heptalogos/host-ownership")>(
    "@heptalogos/host-ownership",
  );
  return {
    ...actual,
    inspectCanonicalHostDatabase: hostOwnershipMocks.inspect,
    provisionHostOwnershipDatabase: hostOwnershipMocks.provision,
    acquireBootstrapHostReservation: hostOwnershipMocks.reserve,
    ensureHostOwnershipSchema: hostOwnershipMocks.schema,
    acquireHostLeaseConnection: hostOwnershipMocks.acquireLease,
    publishHostOwnershipToken: hostOwnershipMocks.publish,
  };
});

function makeContext(
  startupDisposition: "STARTED_BY_THIS_BOOTSTRAP" | "ALREADY_RUNNING",
): {
  readonly context: OwnedBootstrapPreludeHandoffContext;
  readonly ready: ReadyPrivatePostgres & {
    readonly stopSpy: ReturnType<typeof vi.fn>;
    readonly restartSpy: ReturnType<typeof vi.fn>;
  };
  readonly ownership: { state: string; release: ReturnType<typeof vi.fn> };
  readonly session: ReturnType<typeof createPrivatePostgresSessionTracker>;
  readonly stages: string[];
  readonly authority: { compromised: boolean };
} {
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  const bootId = createBootId();
  const session = createPrivatePostgresSessionTracker();
  const sessionToken = session.beginPreparation();
  session.markReady(sessionToken);
  const authority = { compromised: false };
  const ownership = {
    state: "HELD",
    release: vi.fn(async () => {
      ownership.state = "RELEASED";
    }),
  };
  const stages: string[] = [];
  const stopSpy = vi.fn(async (): Promise<void> => {
    if (session.state === "READY") {
      session.beginStop(sessionToken);
      session.markQuiescent(sessionToken);
    }
  });
  const restartSpy = vi.fn(async (): Promise<void> => undefined);
  const ready = {
    installationId,
    instanceId,
    bootId,
    port: 55436,
    clusterSystemIdentifier: "123456789",
    toolchainVersion: "18.6" as const,
    startupDisposition,
    stop: stopSpy as ReadyPrivatePostgres["stop"],
    restart: restartSpy as ReadyPrivatePostgres["restart"],
    stopSpy,
    restartSpy,
  } satisfies ReadyPrivatePostgres & {
    readonly stopSpy: ReturnType<typeof vi.fn>;
    readonly restartSpy: ReturnType<typeof vi.fn>;
  };
  const context = {
    installationId,
    instanceId,
    bootId,
    bootstrapActivityId: "0197cfe0-0000-7000-8000-000000000010" as never,
    paths: {
      resolve: () => ({ canonicalPath: "C:\\heptalogos-instance" }),
    } as never,
    ownership: {
      get state() {
        return ownership.state;
      },
      signal: new AbortController().signal,
      assertHeld: () => undefined,
      release: ownership.release,
    } as never,
    assertOwnership: () => {
      if (authority.compromised) throw new Error("bootstrap ownership compromised");
    },
    state: {
      load: vi.fn(async () => ({
        status: "CURRENT",
        value: {
          state: {
            continuityEpochId: "0197cfe0-0000-7000-8000-000000000001" as never,
          },
          digest: {},
        },
      })),
    } as never,
    journal: {
      checkpoint: vi.fn(async (entry: { readonly stage: string }) => {
        stages.push(entry.stage);
      }),
    } as never,
    privatePostgresSession: session,
    assertReady: (candidate: ReadyPrivatePostgres) => {
      if (candidate !== ready) {
        throw new ProblemError({
          schemaVersion: 1,
          problemCode: "bootstrap.private_postgres.invalid_handle",
          category: "integrity",
          retryClass: "manual",
          title: "invalid test handle",
        });
      }
      return sessionToken;
    },
  } satisfies OwnedBootstrapPreludeHandoffContext;
  return { context, ready, ownership, session, stages, authority };
}

function makeOptions(): HostOwnershipHandoffOptions {
  return {
    initializeCanonicalHost: async ({ authority }) => {
      authority.assertCurrent();
    },
    keyProvider: {
      async withPrivatePostgresBootstrapPassword<T>(
        _context: BootstrapKeyRequestContext,
        use: (passwordUtf8: Uint8Array) => Promise<T>,
      ): Promise<T> {
        return use(new TextEncoder().encode("B".repeat(32)));
      },
      async withPrivatePostgresHostLeasePassword<T>(
        _context: BootstrapKeyRequestContext,
        use: (passwordUtf8: Uint8Array) => Promise<T>,
      ): Promise<T> {
        return use(new TextEncoder().encode("H".repeat(32)));
      },
      async withPrivatePostgresRuntimePassword<T>(
        _context: BootstrapKeyRequestContext,
        use: (passwordUtf8: Uint8Array) => Promise<T>,
      ): Promise<T> {
        return use(new TextEncoder().encode("R".repeat(32)));
      },
      async withPrivatePostgresMigrationPassword<T>(
        _context: BootstrapKeyRequestContext,
        use: (passwordUtf8: Uint8Array) => Promise<T>,
      ): Promise<T> {
        return use(new TextEncoder().encode("M".repeat(32)));
      },
      async withPrivatePostgresDurableExecutionPassword<T>(
        _context: BootstrapKeyRequestContext,
        use: (passwordUtf8: Uint8Array) => Promise<T>,
      ): Promise<T> {
        return use(new TextEncoder().encode("D".repeat(32)));
      },
    },
    timing: {
      connectionTimeoutMs: 1_000,
      statementTimeoutMs: 1_000,
      fenceLockTimeoutMs: 1_000,
      keepAliveInitialDelayMs: 1_000,
    },
  };
}

function installSuccessMocks(): {
  readonly releaseReservation: ReturnType<typeof vi.fn>;
  readonly closeLease: ReturnType<typeof vi.fn>;
} {
  const releaseReservation = vi.fn(async () => undefined);
  const closeLease = vi.fn(async () => undefined);
  hostOwnershipMocks.inspect.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      return { exists: false };
    },
  );
  hostOwnershipMocks.provision.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      const result = {
        ownerRoleCreated: true,
        hostLeaseRoleCreated: true,
        runtimeRoleCreated: true,
        migrationRoleCreated: true,
        durableExecutionRoleCreated: true,
        databaseCreated: true,
      };
      mutationAuthority.assertCurrent();
      return result;
    },
  );
  hostOwnershipMocks.reserve.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      const release = async () => {
        mutationAuthority.assertCurrent();
        await releaseReservation();
        mutationAuthority.assertCurrent();
      };
      mutationAuthority.assertCurrent();
      return { release };
    },
  );
  hostOwnershipMocks.schema.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      const result = {
        schemaCreated: true,
        tableCreated: true,
        fenceRowInitialized: true,
      };
      mutationAuthority.assertCurrent();
      return result;
    },
  );
  hostOwnershipMocks.acquireLease.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      const result = {
        state: "ACTIVE",
        signal: new AbortController().signal,
        assertActive: vi.fn(),
        fence: vi.fn(),
        query: vi.fn(),
        close: closeLease,
      };
      mutationAuthority.assertCurrent();
      return result;
    },
  );
  hostOwnershipMocks.publish.mockImplementation(
    async ({
      mutationAuthority,
    }: {
      readonly mutationAuthority: { assertCurrent(): void };
    }) => {
      mutationAuthority.assertCurrent();
      mutationAuthority.assertCurrent();
    },
  );
  return { releaseReservation, closeLease };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("bootstrap to Host ownership handoff", () => {
  it("publishes a fresh token before releasing bootstrap ownership", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { releaseReservation } = installSuccessMocks();
    const context = await handoffPrivatePostgresToHostForOwnedPrelude(
      fixture.context,
      fixture.ready,
      makeOptions(),
    );

    expect(isUuidV7(context.token)).toBe(true);
    expect(fixture.session.state).toBe("HANDED_OFF");
    expect(fixture.ownership.state).toBe("RELEASED");
    expect(fixture.ready.stopSpy).not.toHaveBeenCalled();
    expect(releaseReservation).toHaveBeenCalledOnce();
    expect(hostOwnershipMocks.publish).toHaveBeenCalledOnce();
    expect(fixture.stages).toEqual([
      "bootstrap.host.database_validated",
      "bootstrap.host.reservation_acquired",
      "bootstrap.host.fence_validated",
      "bootstrap.host.lease_acquired",
      "bootstrap.host.token_published",
      "bootstrap.host.state_authoritative_reloaded",
      "bootstrap.host.canonical_initialization_started",
      "bootstrap.host.canonical_initialization_succeeded",
      "bootstrap.host.forward_handoff_completed",
    ]);
  });

  it("initializes the canonical Host before bootstrap release and managed exposure", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    const events: string[] = [];
    hostOwnershipMocks.publish.mockImplementation(
      async ({
        mutationAuthority,
      }: {
        readonly mutationAuthority: { assertCurrent(): void };
      }) => {
        mutationAuthority.assertCurrent();
        events.push("token_published");
      },
    );
    fixture.ownership.release.mockImplementation(() => {
      events.push("bootstrap_release");
      fixture.ownership.state = "RELEASED";
    });

    await handoffPrivatePostgresToHostForOwnedPrelude(fixture.context, fixture.ready, {
      ...makeOptions(),
      initializeCanonicalHost: async ({ authority }) => {
        events.push("canonical_initializer_enter");
        authority.assertCurrent();
        events.push("canonical_initializer_exit");
      },
    });
    events.push("managed_host_return");

    expect(events).toEqual([
      "token_published",
      "canonical_initializer_enter",
      "canonical_initializer_exit",
      "bootstrap_release",
      "managed_host_return",
    ]);
  });

  it("yields an already-running PostgreSQL process when another Host owns the reservation", async () => {
    const fixture = makeContext("ALREADY_RUNNING");
    hostOwnershipMocks.inspect.mockResolvedValue({ exists: true });
    hostOwnershipMocks.provision.mockResolvedValue({
      ownerRoleCreated: false,
      hostLeaseRoleCreated: false,
      runtimeRoleCreated: false,
      migrationRoleCreated: false,
      durableExecutionRoleCreated: false,
      databaseCreated: false,
    });
    hostOwnershipMocks.reserve.mockResolvedValue(undefined);

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        makeOptions(),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.host.existing_owner_detected" },
    });
    expect(fixture.session.state).toBe("YIELDED_TO_EXISTING_HOST");
    expect(fixture.ownership.state).toBe("RELEASED");
    expect(hostOwnershipMocks.inspect).toHaveBeenCalledOnce();
    expect(hostOwnershipMocks.reserve).toHaveBeenCalledOnce();
    expect(hostOwnershipMocks.provision).not.toHaveBeenCalled();
    expect(hostOwnershipMocks.schema).not.toHaveBeenCalled();
    expect(hostOwnershipMocks.acquireLease).not.toHaveBeenCalled();
    expect(hostOwnershipMocks.publish).not.toHaveBeenCalled();
    expect(fixture.ready.stopSpy).not.toHaveBeenCalled();
  });

  it.each(["EMPTY", "CORRUPT", "RECOVERED_PREVIOUS"] as const)(
    "fails closed when authoritative BootstrapState is %s",
    async (status) => {
      const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
      const { closeLease } = installSuccessMocks();
      const stateLoad = Reflect.get(fixture.context.state, "load") as unknown as {
        mockResolvedValue(value: unknown): void;
      };
      stateLoad.mockResolvedValue(
        status === "CORRUPT"
          ? {
              status,
              problem: {
                schemaVersion: 1,
                problemCode: "bootstrap.state.current_corrupt",
                category: "integrity",
                retryClass: "manual",
                title: "Current BootstrapState is corrupt",
                detail: "test corruption",
              },
            }
          : { status },
      );
      const initializeCanonicalHost = vi.fn(async () => undefined);

      await expect(
        handoffPrivatePostgresToHostForOwnedPrelude(fixture.context, fixture.ready, {
          ...makeOptions(),
          initializeCanonicalHost,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.host.current_state_required" },
      });
      expect(initializeCanonicalHost).not.toHaveBeenCalled();
      expect(closeLease).toHaveBeenCalledOnce();
      expect(fixture.ready.stopSpy).toHaveBeenCalledOnce();
      expect(fixture.session.state).toBe("QUIESCENT");
      expect(fixture.ownership.state).toBe("HELD");
    },
  );

  it("rejects a stale or foreign Ready handle before touching Host ownership", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    const foreign = { ...fixture.ready };

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        foreign,
        makeOptions(),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.private_postgres.invalid_handle" },
    });
    expect(hostOwnershipMocks.provision).not.toHaveBeenCalled();
  });

  it("keeps partial and late handoff failures fail-closed and retryable", async () => {
    const reservationFailure = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { releaseReservation } = installSuccessMocks();
    releaseReservation.mockRejectedValueOnce(new Error("before reservation release"));

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        reservationFailure.context,
        reservationFailure.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("before reservation release");
    expect(reservationFailure.session.state).toBe("READY");
    expect(reservationFailure.ownership.state).toBe("HELD");

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        reservationFailure.context,
        reservationFailure.ready,
        makeOptions(),
      ),
    ).resolves.toMatchObject({ state: "ACTIVE" });
    expect(reservationFailure.session.state).toBe("HANDED_OFF");
    expect(reservationFailure.ownership.state).toBe("RELEASED");

    const leaseFailure = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    hostOwnershipMocks.publish.mockRejectedValueOnce(new Error("before token update"));
    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        leaseFailure.context,
        leaseFailure.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("before token update");
    expect(leaseFailure.session.state).toBe("QUIESCENT");
    expect(leaseFailure.ready.stopSpy).toHaveBeenCalledOnce();
    expect(leaseFailure.ownership.state).toBe("HELD");

    const tokenCommitFailure = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    let publicationCount = 0;
    let firstToken: string | undefined;
    let secondToken: string | undefined;
    (
      hostOwnershipMocks.publish as unknown as {
        mockImplementation(
          implementation: (options: { readonly token: string }) => Promise<void>,
        ): void;
      }
    ).mockImplementation(async (options: { readonly token: string }) => {
      publicationCount += 1;
      if (publicationCount === 1) {
        firstToken = options.token;
        throw new Error("after token commit");
      }
      secondToken = options.token;
    });
    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        tokenCommitFailure.context,
        tokenCommitFailure.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("after token commit");
    expect(tokenCommitFailure.session.state).toBe("QUIESCENT");

    const retryAfterTokenCommit = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        retryAfterTokenCommit.context,
        retryAfterTokenCommit.ready,
        makeOptions(),
      ),
    ).resolves.toMatchObject({ state: "ACTIVE" });
    expect(firstToken).toBeDefined();
    expect(secondToken).toBeDefined();
    expect(secondToken).not.toBe(firstToken);

    const releaseFailure = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { closeLease } = installSuccessMocks();
    releaseFailure.ownership.release.mockRejectedValueOnce(
      new Error("before bootstrap lock release"),
    );
    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        releaseFailure.context,
        releaseFailure.ready,
        makeOptions(),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.host.handoff_release_uncertain" },
    });
    expect(releaseFailure.session.state).toBe("HANDED_OFF");
    expect(releaseFailure.ownership.state).toBe("HELD");
    expect(closeLease).toHaveBeenCalledOnce();
    await (releaseFailure.ownership.release as unknown as () => Promise<void>)();
    expect(releaseFailure.ownership.state).toBe("RELEASED");
  });

  it("does not manufacture Host ACTIVE after bootstrap authority is lost before mutation", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    fixture.authority.compromised = true;

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("bootstrap ownership compromised");
    expect(fixture.session.state).toBe("READY");
    expect(fixture.ownership.state).toBe("HELD");
    expect(hostOwnershipMocks.provision).not.toHaveBeenCalled();
    expect(hostOwnershipMocks.acquireLease).not.toHaveBeenCalled();
  });

  it("stops before schema mutation when authority is lost after reservation", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    hostOwnershipMocks.schema.mockImplementation(
      async ({
        mutationAuthority,
      }: {
        readonly mutationAuthority: { assertCurrent(): void };
      }) => {
        fixture.authority.compromised = true;
        mutationAuthority.assertCurrent();
        return { schemaCreated: true, tableCreated: true, fenceRowInitialized: true };
      },
    );

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("bootstrap ownership compromised");
    expect(hostOwnershipMocks.acquireLease).not.toHaveBeenCalled();
    expect(fixture.session.state).toBe("READY");
    expect(fixture.ownership.state).toBe("HELD");
  });

  it("stops before token publication when authority is lost during Host lease acquisition", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    installSuccessMocks();
    hostOwnershipMocks.acquireLease.mockImplementation(
      async ({
        mutationAuthority,
      }: {
        readonly mutationAuthority: { assertCurrent(): void };
      }) => {
        mutationAuthority.assertCurrent();
        fixture.authority.compromised = true;
        mutationAuthority.assertCurrent();
        return {
          state: "ACTIVE",
          signal: new AbortController().signal,
          assertActive: vi.fn(),
          fence: vi.fn(),
          query: vi.fn(),
        };
      },
    );

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("bootstrap ownership compromised");
    expect(hostOwnershipMocks.publish).not.toHaveBeenCalled();
    expect(fixture.session.state).toBe("READY");
    expect(fixture.ownership.state).toBe("HELD");
  });

  it("fences the tentative Host lease when authority is lost after token mutation", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { closeLease } = installSuccessMocks();
    hostOwnershipMocks.publish.mockImplementation(
      async ({
        mutationAuthority,
      }: {
        readonly mutationAuthority: { assertCurrent(): void };
      }) => {
        fixture.authority.compromised = true;
        mutationAuthority.assertCurrent();
      },
    );

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        makeOptions(),
      ),
    ).rejects.toThrow("bootstrap ownership compromised");
    expect(closeLease).toHaveBeenCalledOnce();
    expect(fixture.session.state).toBe("READY");
    expect(fixture.ownership.state).toBe("HELD");
    expect(fixture.ready.stopSpy).not.toHaveBeenCalled();
  });

  it("keeps the provisional lease and bootstrap authority fenced when canonical initialization fails", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { closeLease } = installSuccessMocks();
    const options: HostOwnershipHandoffOptions = {
      ...makeOptions(),
      initializeCanonicalHost: async () => {
        throw new ProblemError({
          schemaVersion: 1,
          problemCode: "canonical-schema.migration_failed",
          category: "unavailable",
          retryClass: "manual",
          title: "Canonical migration failed",
          detail: "test failure",
        });
      },
    };

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        options,
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "canonical-schema.migration_failed" },
    });
    expect(fixture.session.state).toBe("QUIESCENT");
    expect(fixture.ownership.state).toBe("HELD");
    expect(closeLease).toHaveBeenCalledOnce();
    expect(fixture.ready.stopSpy).toHaveBeenCalledOnce();
    expect(fixture.stages).toContain("bootstrap.host.canonical_initialization_failed");
    expect(fixture.stages).toContain("bootstrap.host.handoff_failed");
  });

  it("fences migration credential use when bootstrap authority is lost during the callback", async () => {
    const fixture = makeContext("STARTED_BY_THIS_BOOTSTRAP");
    const { closeLease } = installSuccessMocks();
    const baseOptions = makeOptions();
    let migrationResolutionCount = 0;
    const options: HostOwnershipHandoffOptions = {
      ...baseOptions,
      keyProvider: {
        ...baseOptions.keyProvider,
        async withPrivatePostgresMigrationPassword<T>(
          _context: BootstrapKeyRequestContext,
          use: (passwordUtf8: Uint8Array) => Promise<T>,
        ) {
          migrationResolutionCount += 1;
          return use(new TextEncoder().encode("M".repeat(32)));
        },
      },
      initializeCanonicalHost: async ({ authority }) => {
        await authority.withMigrationDatabasePassword(async () => {
          fixture.authority.compromised = true;
        });
      },
    };

    await expect(
      handoffPrivatePostgresToHostForOwnedPrelude(
        fixture.context,
        fixture.ready,
        options,
      ),
    ).rejects.toThrow("bootstrap ownership compromised");
    expect(migrationResolutionCount).toBe(1);
    expect(closeLease).toHaveBeenCalledOnce();
    expect(fixture.session.state).toBe("READY");
    expect(fixture.ownership.state).toBe("HELD");
  });
});
