// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  type ContinuityEpochId,
} from "@heptalogos/foundation-contracts";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "../../src/bootstrap/key-provider.js";
import { admitCanonicalHost } from "../../src/host/admission.js";

function keyProvider(): BootstrapKeyProvider {
  return {
    async withPrivatePostgresBootstrapPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new Uint8Array([1]));
    },
    async withPrivatePostgresHostLeasePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new Uint8Array([2]));
    },
    async withPrivatePostgresRuntimePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new Uint8Array([3]));
    },
    async withPrivatePostgresMigrationPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new Uint8Array([4]));
    },
    async withPrivatePostgresDurableExecutionPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new Uint8Array([5]));
    },
  };
}

describe("canonical Host admission", () => {
  it("loads the current epoch before initialization and projects both authorities into signal", async () => {
    const bootstrapController = new AbortController();
    const hostController = new AbortController();
    const events: string[] = [];
    let bootstrapHeld = true;
    let hostActive = true;
    const installationId = createInstallationId();
    const instanceId = createInstanceId();
    const bootId = createBootId();
    const token = createHostOwnershipToken();
    const epoch = "0197cfe0-0000-7000-8000-000000000001" as ContinuityEpochId;

    const admission = await admitCanonicalHost({
      installationId,
      instanceId,
      bootId,
      token,
      port: 55432,
      bootstrapOwnership: {
        signal: bootstrapController.signal,
        assertHeld() {
          if (!bootstrapHeld) throw new Error("bootstrap ownership released");
        },
      },
      hostLeaseConnection: {
        signal: hostController.signal,
        assertActive() {
          if (!hostActive) throw new Error("Host lease closed");
        },
      },
      keyProvider: keyProvider(),
      async loadCurrentContinuityEpochId() {
        events.push("state.load");
        return epoch;
      },
      async initializeCanonicalHost({ authority, expectedContinuityEpochId }) {
        events.push("canonical.initialize");
        expect(expectedContinuityEpochId).toBe(epoch);
        authority.assertCurrent();
      },
    });

    expect(events).toEqual(["state.load", "canonical.initialize"]);
    expect(admission.continuityEpochId).toBe(epoch);
    expect(admission.authority.signal.aborted).toBe(false);

    bootstrapHeld = false;
    bootstrapController.abort();
    expect(admission.authority.signal.aborted).toBe(true);
    expect(() => admission.authority.assertCurrent()).toThrow(
      "bootstrap ownership released",
    );

    hostActive = false;
    hostController.abort();
  });
});
