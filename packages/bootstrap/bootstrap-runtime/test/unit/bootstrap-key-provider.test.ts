// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "../../src/bootstrap/key-provider.js";

describe("BootstrapKeyProvider", () => {
  it("keeps password plaintext inside one callback-scoped lifetime", async () => {
    const context: BootstrapKeyRequestContext = {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootId: createBootId(),
      purpose: "private-postgres-bootstrap-superuser",
    };
    let callbackCount = 0;
    let callbackPassword: Uint8Array | undefined;
    let providerBuffer: Uint8Array | undefined;

    const provider: BootstrapKeyProvider = {
      async withPrivatePostgresBootstrapPassword(_context, use) {
        providerBuffer = new TextEncoder().encode(
          "PRIVATE_POSTGRES_TEST_SCOPED_PASSWORD",
        );
        try {
          return await use(providerBuffer);
        } finally {
          providerBuffer.fill(0);
          providerBuffer = undefined;
        }
      },
      async withPrivatePostgresHostLeasePassword(_context, use) {
        const hostPassword = new TextEncoder().encode("H".repeat(32));
        try {
          return await use(hostPassword);
        } finally {
          hostPassword.fill(0);
        }
      },
      async withPrivatePostgresRuntimePassword(_context, use) {
        return use(new Uint8Array());
      },
      async withPrivatePostgresMigrationPassword(_context, use) {
        return use(new TextEncoder().encode("M".repeat(32)));
      },
      async withPrivatePostgresDurableExecutionPassword(_context, use) {
        return use(new TextEncoder().encode("D".repeat(32)));
      },
    };

    await provider.withPrivatePostgresBootstrapPassword(context, async (password) => {
      callbackCount += 1;
      callbackPassword = password;
      expect(new TextDecoder().decode(password)).toBe(
        "PRIVATE_POSTGRES_TEST_SCOPED_PASSWORD",
      );
      return "used";
    });

    expect(callbackCount).toBe(1);
    expect(callbackPassword).toBeDefined();
    expect(new TextDecoder().decode(callbackPassword)).toBe(
      "\0".repeat(callbackPassword?.length ?? 0),
    );
    expect("getPassword" in provider).toBe(false);
  });

  it("keeps the host lease credential as a distinct callback purpose", async () => {
    const context: BootstrapKeyRequestContext = {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootId: createBootId(),
      purpose: "private-postgres-host-lease-role",
    };
    const provider: BootstrapKeyProvider = {
      async withPrivatePostgresBootstrapPassword(_context, use) {
        return use(new Uint8Array());
      },
      async withPrivatePostgresHostLeasePassword(_context, use) {
        const password = new TextEncoder().encode("H".repeat(32));
        try {
          return await use(password);
        } finally {
          password.fill(0);
        }
      },
      async withPrivatePostgresRuntimePassword(_context, use) {
        return use(new Uint8Array());
      },
      async withPrivatePostgresMigrationPassword(_context, use) {
        return use(new TextEncoder().encode("M".repeat(32)));
      },
      async withPrivatePostgresDurableExecutionPassword(_context, use) {
        return use(new TextEncoder().encode("D".repeat(32)));
      },
    };
    let observedPurpose: BootstrapKeyRequestContext["purpose"] | undefined;
    let observedLength = 0;

    await provider.withPrivatePostgresHostLeasePassword(context, async (password) => {
      observedPurpose = context.purpose;
      observedLength = password.byteLength;
      return undefined;
    });

    expect(observedPurpose).toBe("private-postgres-host-lease-role");
    expect(observedLength).toBe(32);
  });

  it("keeps the runtime credential as a distinct callback purpose", async () => {
    const context: BootstrapKeyRequestContext = {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootId: createBootId(),
      purpose: "private-postgres-runtime-role",
    };
    const provider: BootstrapKeyProvider = {
      async withPrivatePostgresBootstrapPassword(_context, use) {
        return use(new Uint8Array());
      },
      async withPrivatePostgresHostLeasePassword(_context, use) {
        return use(new Uint8Array());
      },
      async withPrivatePostgresRuntimePassword(_context, use) {
        const password = new TextEncoder().encode("R".repeat(32));
        try {
          return await use(password);
        } finally {
          password.fill(0);
        }
      },
      async withPrivatePostgresMigrationPassword(_context, use) {
        return use(new TextEncoder().encode("M".repeat(32)));
      },
      async withPrivatePostgresDurableExecutionPassword(_context, use) {
        return use(new TextEncoder().encode("D".repeat(32)));
      },
    };
    let observedPurpose: BootstrapKeyRequestContext["purpose"] | undefined;
    let observedPassword = "";

    await provider.withPrivatePostgresRuntimePassword(context, async (password) => {
      observedPurpose = context.purpose;
      observedPassword = new TextDecoder().decode(password);
      return undefined;
    });

    expect(observedPurpose).toBe("private-postgres-runtime-role");
    expect(observedPassword).toBe("R".repeat(32));

    const migrationContext: BootstrapKeyRequestContext = {
      ...context,
      purpose: "private-postgres-migration-role",
    };
    let observedMigrationPassword = "";
    await provider.withPrivatePostgresMigrationPassword(
      migrationContext,
      async (password) => {
        observedMigrationPassword = new TextDecoder().decode(password);
        return undefined;
      },
    );
    expect(observedMigrationPassword).toBe("M".repeat(32));
  });
});
