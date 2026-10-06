// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createMicroSystemId,
  parseDurableCodeVersion,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import {
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  type HostDurableExecutionAuthority,
} from "@heptalogos/host-ownership";
import {
  createWorkQueueProfileCatalog,
  type WorkAttemptExecutor,
  type WorkQueueProfileId,
} from "@heptalogos/work-queue";
import type {
  DurableExecutionPoolOptions,
  DurableExecutionRuntimeOptions,
} from "../../src/contracts.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetDbosBindingForTests,
  type BindingDriver,
} from "../../src/runtime/binding.js";
import {
  assertDurableExecutionDispatchOpen,
  createDurableExecutionRuntimeForTests,
} from "../../src/runtime/runtime.js";

const profileId = createMicroSystemId("default-work") as unknown as WorkQueueProfileId;
const profiles = createWorkQueueProfileCatalog([
  { profileId, minPollingIntervalMs: 100 },
]);
const durableCodeVersion = parseDurableCodeVersion("a".repeat(64));
if (durableCodeVersion === undefined) {
  throw new Error("Test durable code version is invalid");
}

const runtimeOptions: DurableExecutionRuntimeOptions = {
  durableCodeVersion,
  systemPool: {
    maxConnections: 3,
    idleTimeoutMs: 4_000,
    connectionTimeoutMs: 5_000,
    statementTimeoutMs: 6_000,
    idleInTransactionSessionTimeoutMs: 7_000,
  },
  systemDatabasePollingConcurrency: 2,
  maxConcurrentQueueDispatches: 2,
  workflowMaxRecoveryAttempts: 4,
  shutdownDrainTimeoutMs: 8_000,
  profiles,
  onTerminalFailure() {},
  onBackgroundError() {},
};

interface AuthorityFixture {
  readonly authority: HostDurableExecutionAuthority;
  readonly controller: AbortController;
  setActive(active: boolean): void;
}

function authorityFixture(
  instanceId: InstanceId = createInstanceId(),
): AuthorityFixture {
  const controller = new AbortController();
  let active = true;
  const authority: HostDurableExecutionAuthority = {
    installationId: createInstallationId(),
    instanceId,
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    token: createHostOwnershipToken(),
    target: {
      host: "127.0.0.1",
      port: 55432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_DURABLE_EXECUTION_ROLE,
    },
    signal: controller.signal,
    assertActive() {
      if (!active || controller.signal.aborted) {
        throw new Error("Host authority is inactive");
      }
    },
    async withDurableExecutionDatabasePassword(use) {
      const password = new TextEncoder().encode("D".repeat(32));
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
  return {
    authority,
    controller,
    setActive(value) {
      active = value;
    },
  };
}

interface PoolFixture {
  readonly end: () => Promise<void>;
  readonly ended: () => boolean;
}

interface FakeQueue {
  getGlobalConcurrency(): Promise<number | undefined>;
  getWorkerConcurrency(): Promise<number | undefined>;
  getRateLimit(): Promise<
    { readonly limitPerPeriod: number; readonly periodSec: number } | undefined
  >;
  getPartitionConcurrency(): Promise<number | undefined>;
  getPartitionWorkerConcurrency(): Promise<number | undefined>;
  getPartitionRateLimit(): Promise<
    { readonly limitPerPeriod: number; readonly periodSec: number } | undefined
  >;
  getPartitionQueue(): Promise<boolean>;
  getMinPollingIntervalMs(): Promise<number | undefined>;
}

interface RuntimeFixture {
  readonly dependencies: {
    readonly createPool: (
      authority: HostDurableExecutionAuthority,
      options: DurableExecutionPoolOptions,
      onBackgroundError: (error: unknown) => void,
    ) => PoolFixture;
    readonly dbos: {
      withQueueClient<T>(
        authority: HostDurableExecutionAuthority,
        pool: PoolFixture,
        options: unknown,
        use: (client: {
          registerQueue(name: string, options: unknown): Promise<FakeQueue>;
        }) => Promise<T>,
      ): Promise<T>;
      setConfig(config: unknown): void;
      launch(): Promise<void>;
      shutdown(options: {
        readonly workflowCompletionTimeoutMS: number;
      }): Promise<void>;
    };
    readonly bindingDriver: BindingDriver;
  };
  readonly pools: PoolFixture[];
  readonly configs: Record<string, unknown>[];
  readonly registrations: number[];
  readonly trace: string[];
}

function runtimeFixture(
  queueMismatch = false,
  options: {
    readonly shutdownErrors?: readonly unknown[];
    readonly poolEndErrors?: readonly unknown[];
  } = {},
): RuntimeFixture {
  const pools: PoolFixture[] = [];
  const configs: Record<string, unknown>[] = [];
  const registrations: number[] = [];
  const trace: string[] = [];
  const shutdownErrors = [...(options.shutdownErrors ?? [])];
  const poolEndErrors = [...(options.poolEndErrors ?? [])];
  const dependencies: RuntimeFixture["dependencies"] = {
    createPool() {
      let isEnded = false;
      const pool: PoolFixture = {
        async end() {
          trace.push("pool.end");
          if (poolEndErrors.length > 0) throw poolEndErrors.shift();
          isEnded = true;
        },
        ended() {
          return isEnded;
        },
      };
      pools.push(pool);
      trace.push("pool.create");
      return pool;
    },
    dbos: {
      async withQueueClient(_authority, _pool, _options, use) {
        trace.push("dbos.client.create");
        trace.push("dbos.client.callback.enter");
        try {
          return await use({ registerQueue });
        } finally {
          trace.push("dbos.client.destroy");
          trace.push("dbos.client.callback.exit");
        }
      },
      setConfig(config) {
        configs.push(config as Record<string, unknown>);
        trace.push("dbos.setConfig");
      },
      async launch() {
        trace.push("dbos.launch");
      },
      async shutdown() {
        trace.push("dbos.shutdown");
        if (shutdownErrors.length > 0) throw shutdownErrors.shift();
      },
    },
    bindingDriver: {
      registerWorkflow(_maxRecoveryAttempts, execute) {
        registrations.push(_maxRecoveryAttempts);
        return (workItemId, dispatchRevision) => execute(workItemId, dispatchRevision);
      },
    },
  };

  async function registerQueue(_name: string, options: unknown): Promise<FakeQueue> {
    trace.push("dbos.registerQueue");
    const params = options as {
      readonly globalConcurrency?: number;
      readonly workerConcurrency?: number;
      readonly rateLimit?: {
        readonly limitPerPeriod: number;
        readonly periodSec: number;
      };
      readonly partitionConcurrency?: number;
      readonly partitionWorkerConcurrency?: number;
      readonly partitionRateLimit?: {
        readonly limitPerPeriod: number;
        readonly periodSec: number;
      };
      readonly minPollingIntervalMs?: number;
    };
    const globalConcurrency = queueMismatch
      ? (params.globalConcurrency ?? 0) + 1
      : params.globalConcurrency;
    return {
      getGlobalConcurrency: async () => globalConcurrency,
      getWorkerConcurrency: async () => params.workerConcurrency,
      getRateLimit: async () => params.rateLimit,
      getPartitionConcurrency: async () => params.partitionConcurrency,
      getPartitionWorkerConcurrency: async () => params.partitionWorkerConcurrency,
      getPartitionRateLimit: async () => params.partitionRateLimit,
      getPartitionQueue: async () =>
        params.partitionConcurrency !== undefined ||
        params.partitionWorkerConcurrency !== undefined ||
        params.partitionRateLimit !== undefined,
      getMinPollingIntervalMs: async () => params.minPollingIntervalMs,
    };
  }
  return { dependencies, pools, configs, registrations, trace };
}

function executor(): WorkAttemptExecutor {
  return {
    async execute() {
      return { status: "SUCCEEDED" };
    },
  };
}

beforeEach(() => {
  resetDbosBindingForTests();
});

describe.sequential("Host-bound DurableExecution runtime", () => {
  it("makes close terminal from CREATED and detaches the Host abort listener", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture();
    const backgroundErrors: unknown[] = [];
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      { ...runtimeOptions, onBackgroundError: (error) => backgroundErrors.push(error) },
      executor(),
      fixture.dependencies,
    );

    await runtime.close();
    await runtime.close();
    expect(runtime.state).toBe("CLOSED");
    expect(fixture.trace).toEqual([]);
    await expect(runtime.start()).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.runtime.invalid_transition" },
    });

    authority.controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(backgroundErrors).toHaveLength(0);
  });

  it("uses InstanceId as the stable DBOS executor identity across BootIds", async () => {
    const firstAuthority = authorityFixture();
    const firstFixture = runtimeFixture();
    const first = createDurableExecutionRuntimeForTests(
      firstAuthority.authority,
      runtimeOptions,
      executor(),
      firstFixture.dependencies,
    );
    await first.start();
    const firstConfig = firstFixture.configs[0];
    expect(firstAuthority.authority.bootId).toBeDefined();
    await first.close();

    const secondAuthority = authorityFixture(firstAuthority.authority.instanceId);
    const secondFixture = runtimeFixture();
    const second = createDurableExecutionRuntimeForTests(
      secondAuthority.authority,
      runtimeOptions,
      executor(),
      secondFixture.dependencies,
    );
    await second.start();
    const secondConfig = secondFixture.configs[0];

    expect(secondAuthority.authority.bootId).not.toBe(firstAuthority.authority.bootId);
    expect(firstConfig?.executorID).toBe(firstAuthority.authority.instanceId);
    expect(secondConfig?.executorID).toBe(firstAuthority.authority.instanceId);
    expect(secondConfig?.executorID).toBe(firstConfig?.executorID);
    await second.close();

    const thirdAuthority = authorityFixture();
    const thirdFixture = runtimeFixture();
    const third = createDurableExecutionRuntimeForTests(
      thirdAuthority.authority,
      runtimeOptions,
      executor(),
      thirdFixture.dependencies,
    );
    await third.start();
    expect(thirdFixture.configs[0]?.executorID).toBe(
      thirdAuthority.authority.instanceId,
    );
    expect(thirdFixture.configs[0]?.executorID).not.toBe(firstConfig?.executorID);
    await third.close();
  });

  it("uses the exact DBOS lifecycle configuration and closes DBOS before the pool", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture();
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await runtime.start();
    expect(fixture.configs[0]).toMatchObject({
      name: "heptalogos",
      applicationVersion: durableCodeVersion,
      executorID: authority.authority.instanceId,
      systemDatabaseSchemaName: "dbos",
      systemDatabasePollingConcurrency: 2,
      runMigrations: false,
      runAdminServer: false,
      listenQueues: ["heptalogos.queue.default-work"],
      maxConcurrentQueueDispatches: 2,
    });
    expect(fixture.configs[0]).toHaveProperty("systemDatabasePool");
    expect(fixture.configs[0]).not.toHaveProperty("systemDatabaseUrl");

    await runtime.close();
    await runtime.close();
    expect(fixture.trace.indexOf("dbos.shutdown")).toBeGreaterThan(-1);
    expect(fixture.trace.indexOf("dbos.shutdown")).toBeLessThan(
      fixture.trace.indexOf("pool.end"),
    );
    expect(fixture.trace.filter((entry) => entry === "dbos.shutdown")).toHaveLength(1);
    expect(fixture.pools[0]?.ended()).toBe(true);
  });

  it("preflights queue profiles before configuring and launching DBOS", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture();
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await runtime.start();

    const position = (entry: string): number => fixture.trace.indexOf(entry);
    expect(position("pool.create")).toBeLessThan(position("dbos.client.create"));
    expect(position("dbos.client.callback.enter")).toBeLessThan(
      position("dbos.registerQueue"),
    );
    expect(position("dbos.client.create")).toBeLessThan(position("dbos.registerQueue"));
    expect(position("dbos.registerQueue")).toBeLessThan(
      position("dbos.client.destroy"),
    );
    expect(position("dbos.client.destroy")).toBeLessThan(
      position("dbos.client.callback.exit"),
    );
    expect(position("dbos.client.destroy")).toBeLessThan(position("dbos.setConfig"));
    expect(position("dbos.setConfig")).toBeLessThan(position("dbos.launch"));
    expect(fixture.pools[0]?.ended()).toBe(false);

    await runtime.close();
  });

  it("rejects a persisted queue mismatch before DBOS launch", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture(true);
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await expect(runtime.start()).rejects.toMatchObject({
      problem: { problemCode: "durable_execution.queue_profile_mismatch" },
    });
    expect(runtime.state).toBe("FAILED");
    expect(fixture.trace).toContain("dbos.client.create");
    expect(fixture.trace).toContain("dbos.registerQueue");
    expect(fixture.trace).toContain("dbos.client.destroy");
    expect(fixture.trace).toContain("pool.end");
    expect(fixture.trace).not.toContain("dbos.setConfig");
    expect(fixture.trace).not.toContain("dbos.launch");
  });

  it("keeps close retryable when provider teardown fails after the safe drain", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture(false, {
      shutdownErrors: [new Error("provider teardown failed")],
    });
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await runtime.start();
    await expect(runtime.close()).rejects.toThrow("provider teardown failed");
    expect(runtime.state).toBe("FAILED");
    expect(fixture.pools[0]?.ended()).toBe(false);

    await expect(runtime.close()).resolves.toBeUndefined();
    expect(runtime.state).toBe("CLOSED");
    expect(fixture.pools[0]?.ended()).toBe(true);
  });

  it("does not publish CLOSED or release binding when DBOS shutdown is unproven", async () => {
    const authority = authorityFixture();
    const shutdownError = new Error("DBOS shutdown failed");
    const fixture = runtimeFixture(false, { shutdownErrors: [shutdownError] });
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await runtime.start();
    await expect(runtime.close()).rejects.toBe(shutdownError);
    expect(runtime.state).toBe("FAILED");
    expect(fixture.pools[0]?.ended()).toBe(false);
    expect(fixture.trace).not.toContain("pool.end");

    const retry = createDurableExecutionRuntimeForTests(
      authorityFixture().authority,
      runtimeOptions,
      executor(),
      runtimeFixture().dependencies,
    );
    await expect(retry.start()).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.binding.active" },
    });
    await retry.close();

    await expect(runtime.close()).resolves.toBeUndefined();
    expect(runtime.state).toBe("CLOSED");
    expect(fixture.pools[0]?.ended()).toBe(true);
  });

  it("retains pool ownership after end failure and closes on retry", async () => {
    const authority = authorityFixture();
    const poolError = new Error("pool end failed");
    const fixture = runtimeFixture(false, { poolEndErrors: [poolError] });
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    await runtime.start();
    await expect(runtime.close()).rejects.toBe(poolError);
    expect(runtime.state).toBe("FAILED");
    expect(fixture.pools[0]?.ended()).toBe(false);
    expect(fixture.trace.filter((entry) => entry === "pool.end")).toHaveLength(1);

    await expect(runtime.close()).resolves.toBeUndefined();
    expect(runtime.state).toBe("CLOSED");
    expect(fixture.pools[0]?.ended()).toBe(true);
    expect(fixture.trace.filter((entry) => entry === "pool.end")).toHaveLength(2);
  });

  it("rejects dispatch outside OPEN and after the Host authority is fenced", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture();
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      runtimeOptions,
      executor(),
      fixture.dependencies,
    );

    expect(() =>
      assertDurableExecutionDispatchOpen(runtime.state, authority.authority),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.dispatch.not_open",
        }),
      }),
    );
    await runtime.start();
    expect(() =>
      assertDurableExecutionDispatchOpen(runtime.state, authority.authority),
    ).not.toThrow();

    authority.setActive(false);
    expect(() =>
      assertDurableExecutionDispatchOpen("OPEN", authority.authority),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.runtime.authority_lost",
        }),
      }),
    );
    await runtime.close();
    expect(() =>
      assertDurableExecutionDispatchOpen(runtime.state, authority.authority),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.dispatch.not_open",
        }),
      }),
    );
  });

  it("closes admission and drains on Host abort", async () => {
    const authority = authorityFixture();
    const fixture = runtimeFixture();
    const backgroundErrors: unknown[] = [];
    const runtime = createDurableExecutionRuntimeForTests(
      authority.authority,
      { ...runtimeOptions, onBackgroundError: (error) => backgroundErrors.push(error) },
      executor(),
      fixture.dependencies,
    );
    await runtime.start();

    authority.controller.abort();
    for (let attempt = 0; attempt < 10 && runtime.state !== "CLOSED"; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(runtime.state).toBe("CLOSED");
    expect(fixture.pools[0]?.ended()).toBe(true);
    expect(backgroundErrors).toHaveLength(0);
  });

  it("rejects a second active binding but permits rebind after close", async () => {
    const firstAuthority = authorityFixture();
    const firstFixture = runtimeFixture();
    const first = createDurableExecutionRuntimeForTests(
      firstAuthority.authority,
      runtimeOptions,
      executor(),
      firstFixture.dependencies,
    );
    await first.start();

    const secondAuthority = authorityFixture();
    const secondFixture = runtimeFixture();
    const second = createDurableExecutionRuntimeForTests(
      secondAuthority.authority,
      runtimeOptions,
      executor(),
      secondFixture.dependencies,
    );
    await expect(second.start()).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.binding.active" },
    });
    expect(second.state).toBe("FAILED");
    await second.close();
    await first.close();

    const reboundAuthority = authorityFixture();
    const reboundFixture = runtimeFixture();
    const rebound = createDurableExecutionRuntimeForTests(
      reboundAuthority.authority,
      runtimeOptions,
      executor(),
      reboundFixture.dependencies,
    );
    await rebound.start();
    expect(firstFixture.registrations).toHaveLength(1);
    expect(reboundFixture.registrations).toHaveLength(0);
    await rebound.close();
    await first.close();
  });

  it("keeps the process-global recovery budget fixed", async () => {
    const firstAuthority = authorityFixture();
    const firstFixture = runtimeFixture();
    const first = createDurableExecutionRuntimeForTests(
      firstAuthority.authority,
      runtimeOptions,
      executor(),
      firstFixture.dependencies,
    );
    await first.start();
    await first.close();

    const secondAuthority = authorityFixture();
    const secondFixture = runtimeFixture();
    const second = createDurableExecutionRuntimeForTests(
      secondAuthority.authority,
      { ...runtimeOptions, workflowMaxRecoveryAttempts: 5 },
      executor(),
      secondFixture.dependencies,
    );
    await expect(second.start()).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.binding.recovery_budget_mismatch" },
    });
    expect(second.state).toBe("FAILED");
    await second.close();
    expect(firstFixture.registrations).toHaveLength(1);
    expect(secondFixture.registrations).toHaveLength(0);
  });
});
