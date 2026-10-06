// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import {
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_RUNTIME_ROLE,
  type HostOwnershipContext,
} from "@heptalogos/host-ownership";
import {
  assertManagedHostContext,
  createManagedHostContext,
  markManagedHostTerminal,
  type BootstrapManagedHostContext,
  type ManagedHostDurableExecutionOptions,
  type ManagedHostPersistenceOptions,
} from "../../src/host/managed-host.js";

const continuityEpochId =
  "0197cfe0-0000-7000-8000-000000000001" as ManagedHostPersistenceOptions["continuityEpochId"];

const persistenceOptions: ManagedHostPersistenceOptions = {
  continuityEpochId,
  target: {
    host: "127.0.0.1",
    port: 55436,
    database: HOST_OWNERSHIP_CANONICAL_DATABASE,
    user: HOST_RUNTIME_ROLE,
  },
  async withRuntimeDatabasePassword(use) {
    return use(new TextEncoder().encode("R".repeat(32)));
  },
};

const durableExecutionOptions: ManagedHostDurableExecutionOptions = {
  continuityEpochId,
  target: {
    host: "127.0.0.1",
    port: 55436,
    database: HOST_OWNERSHIP_CANONICAL_DATABASE,
    user: HOST_DURABLE_EXECUTION_ROLE,
  },
  async withDurableExecutionDatabasePassword(use) {
    return use(new TextEncoder().encode("D".repeat(32)));
  },
};

function rawHost(): HostOwnershipContext {
  return {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    token: createHostOwnershipToken(),
    state: "ACTIVE",
    signal: new AbortController().signal,
    assertActive() {},
    async close() {},
  };
}

function managedHost(raw = rawHost()): BootstrapManagedHostContext {
  return createManagedHostContext(
    raw,
    {
      async preparePrivatePostgresMaintenance() {
        throw new Error("maintenance fixture is not implemented");
      },
      async shutdownKeepingPrivatePostgres() {},
    },
    persistenceOptions,
    durableExecutionOptions,
  );
}

describe("managed Host capability", () => {
  it("preserves the Host identity view without exposing raw close", () => {
    const raw = rawHost();
    const value = managedHost(raw);
    expect(value.installationId).toBe(raw.installationId);
    expect(value.instanceId).toBe(raw.instanceId);
    expect(value.bootId).toBe(raw.bootId);
    expect(value.token).toBe(raw.token);
    expect(value.state).toBe("ACTIVE");
    expect("close" in value).toBe(false);
  });

  it("rejects structurally forged managed Host objects", () => {
    expect(() =>
      assertManagedHostContext({
        state: "ACTIVE",
      } as unknown as BootstrapManagedHostContext),
    ).toThrow();
  });

  it("fences all managed authorities when the Host becomes terminal", async () => {
    const value = managedHost();
    markManagedHostTerminal(value);
    expect(value.state).toBe("CLOSED");
    expect(() => value.assertActive()).toThrow();
    expect(() => value.persistence.assertActive()).toThrow();
    expect(() => value.durableExecution.assertActive()).toThrow();
    await expect(
      value.persistence.withRuntimeDatabasePassword(async () => "not-called"),
    ).rejects.toThrow();
    await expect(
      value.durableExecution.withDurableExecutionDatabasePassword(
        async () => "not-called",
      ),
    ).rejects.toThrow();
  });
});
