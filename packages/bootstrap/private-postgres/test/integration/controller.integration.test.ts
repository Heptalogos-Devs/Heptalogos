// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import type {
  PrivatePostgresExpectedIdentity,
  PrivatePostgresInitializationResult,
} from "../../src/contracts.js";

const pgBin = process.env.HEPTALOGOS_TEST_PG_BIN;
if (!pgBin) {
  throw new Error(
    "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for private PostgreSQL integration qualification",
  );
}
const qualifiedPgBin = pgBin;
const allowControlAuthority = (): void => undefined;
const POSTGRES_INTEGRATION_TEST_TIMEOUT_MS = 120_000;

const { resolvePrivatePostgresToolchain } = await import("../../src/toolchain.js");
const { PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME, PRIVATE_POSTGRES_QUALIFIED_VERSION } =
  await import("../../src/contracts.js");
const { resolvePrivatePostgresPlacement } = await import("../../src/cluster-layout.js");
const {
  createPrivatePostgresInitializationProfileRevision,
  initializePrivatePostgresCluster,
  startPrivatePostgresCluster,
  validateExistingCluster,
} = await import("../../src/controller.js");
const { runPostgresTool } = await import("../../src/process-adapter.js");

describe("private PostgreSQL first initialization", () => {
  it(
    "initializes an absent target with the deterministic private-postgres profile",
    async () => {
      const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
      const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
      const logRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-log-"));
      const placement = resolvePrivatePostgresPlacement(dataRoot);
      const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);

      try {
        expect(toolchain.version).toBe(PRIVATE_POSTGRES_QUALIFIED_VERSION);
        const result = await initializePrivatePostgresCluster({
          toolchain,
          placement,
          credentialTempRoot: tempRoot,
          bootstrapPasswordUtf8: new TextEncoder().encode(
            "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
          ),
          port: 55432,
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority: allowControlAuthority,
        });

        expect(result.identity.postgresMajor).toBe(18);
        expect(result.identity.clusterSystemIdentifier).toMatch(/^[0-9]+$/u);
        expect(result.dataPageChecksumVersion).toBe(1);
        expect(result.initializationProfileRevision).toBe(
          createPrivatePostgresInitializationProfileRevision(55432),
        );
        await expect(
          readFile(join(placement.canonicalDataDirectory, "PG_VERSION"), "utf8"),
        ).resolves.toBe("18\n");
        await expect(
          readFile(
            join(placement.canonicalDataDirectory, "postgresql.auto.conf"),
            "utf8",
          ),
        ).resolves.toBe(
          "listen_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = 55432\npassword_encryption = 'scram-sha-256'\n",
        );
        await expect(
          readFile(join(placement.canonicalDataDirectory, "pg_hba.conf"), "utf8"),
        ).resolves.toBe(
          "# Heptalogos private PostgreSQL HBA profile v1\nhost all all 127.0.0.1/32 scram-sha-256\n",
        );
        expect(JSON.stringify(result)).not.toContain(
          "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
        );
      } finally {
        await Promise.all(
          [dataRoot, tempRoot, logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    },
    POSTGRES_INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("requires control authority before initdb and leaves the target untouched", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
    const placement = resolvePrivatePostgresPlacement(dataRoot);
    const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
    const assertControlAuthority = () => {
      throw new Error("authority revoked");
    };

    try {
      await expect(
        initializePrivatePostgresCluster({
          toolchain,
          placement,
          credentialTempRoot: tempRoot,
          bootstrapPasswordUtf8: new TextEncoder().encode(
            "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
          ),
          port: 55445,
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority,
        }),
      ).rejects.toThrow("authority revoked");
      await expect(access(placement.canonicalDataDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await Promise.all(
        [dataRoot, tempRoot].map((root) => rm(root, { recursive: true, force: true })),
      );
    }
  });

  it("refuses a non-empty target before initdb and leaves it unchanged", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
    const placement = resolvePrivatePostgresPlacement(dataRoot);
    const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);

    try {
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(placement.canonicalDataDirectory),
      );
      await writeFile(join(placement.canonicalDataDirectory, "PG_VERSION"), "18\n");

      await expect(
        initializePrivatePostgresCluster({
          toolchain,
          placement,
          credentialTempRoot: tempRoot,
          bootstrapPasswordUtf8: new TextEncoder().encode(
            "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
          ),
          port: 55432,
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority: allowControlAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.cluster.non_empty_target" },
      });
      await expect(
        access(join(placement.canonicalDataDirectory, "PG_VERSION")),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all(
        [dataRoot, tempRoot].map((root) => rm(root, { recursive: true, force: true })),
      );
    }
  });

  describe("authoritative existing cluster validation", () => {
    let dataRoot: string;
    let tempRoot: string;
    let initialized: PrivatePostgresInitializationResult;
    let expected: PrivatePostgresExpectedIdentity;

    beforeAll(async () => {
      dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
      tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
      const placement = resolvePrivatePostgresPlacement(dataRoot);
      const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
      initialized = await initializePrivatePostgresCluster({
        toolchain,
        placement,
        credentialTempRoot: tempRoot,
        bootstrapPasswordUtf8: new TextEncoder().encode(
          "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
        ),
        port: 55432,
        lifecycle: {
          startupTimeoutMs: 60_000,
          shutdownTimeoutMs: 30_000,
          readinessPollIntervalMs: 100,
        },
        assertControlAuthority: allowControlAuthority,
      });
      expected = {
        installationId: createInstallationId(),
        instanceId: createInstanceId(),
        postgresMajor: initialized.identity.postgresMajor,
        bootstrapRoleName: initialized.identity.bootstrapRoleName,
        placement: {
          rootId: "DATA",
          relativePath: "private-postgres",
          dataLayoutVersion: 1,
        },
        persistedPort: initialized.port,
        clusterSystemIdentifier: initialized.identity.clusterSystemIdentifier,
        initializationProfileRevision: initialized.initializationProfileRevision,
      };
    });

    afterAll(async () => {
      await Promise.all(
        [dataRoot, tempRoot].map((root) => rm(root, { recursive: true, force: true })),
      );
    });

    it("validates the existing cluster without starting it", async () => {
      const validated = await validateExistingCluster({
        toolchain: initialized.toolchain,
        placement: initialized.placement,
        expectedIdentity: expected,
        timeoutMs: 60_000,
      });

      expect(validated.identity.clusterSystemIdentifier).toBe(
        expected.clusterSystemIdentifier,
      );
      await expect(
        access(join(initialized.placement.canonicalDataDirectory, "postmaster.pid")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects a later duplicate unsafe listen address using effective PostgreSQL semantics", async () => {
      const profilePath = join(
        initialized.placement.canonicalDataDirectory,
        "postgresql.auto.conf",
      );
      const original = await readFile(profilePath, "utf8");
      try {
        await writeFile(profilePath, `${original}listen_addresses = '*'\n`);
        await expect(
          validateExistingCluster({
            toolchain: initialized.toolchain,
            placement: initialized.placement,
            expectedIdentity: expected,
            timeoutMs: 60_000,
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.cluster.identity_mismatch" },
        });
      } finally {
        await writeFile(profilePath, original);
      }
    }, 120_000);

    it("rejects a later duplicate persisted port using effective PostgreSQL semantics", async () => {
      const profilePath = join(
        initialized.placement.canonicalDataDirectory,
        "postgresql.auto.conf",
      );
      const original = await readFile(profilePath, "utf8");
      try {
        await writeFile(profilePath, `${original}port = 55453\n`);
        await expect(
          validateExistingCluster({
            toolchain: initialized.toolchain,
            placement: initialized.placement,
            expectedIdentity: expected,
            timeoutMs: 60_000,
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.cluster.identity_mismatch" },
        });
      } finally {
        await writeFile(profilePath, original);
      }
    }, 120_000);

    it("rejects an effective data directory redirection", async () => {
      const redirectedRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-redirect-"));
      const profilePath = join(
        initialized.placement.canonicalDataDirectory,
        "postgresql.conf",
      );
      const original = await readFile(profilePath, "utf8");
      try {
        await writeFile(
          profilePath,
          `${original}data_directory = '${redirectedRoot}'\n`,
        );
        await expect(
          validateExistingCluster({
            toolchain: initialized.toolchain,
            placement: initialized.placement,
            expectedIdentity: expected,
            timeoutMs: 60_000,
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.cluster.identity_mismatch" },
        });
      } finally {
        await writeFile(profilePath, original);
        await rm(redirectedRoot, { recursive: true, force: true });
      }
    }, 120_000);

    it("rejects HBA trust tampering", async () => {
      const hbaPath = join(initialized.placement.canonicalDataDirectory, "pg_hba.conf");
      const original = await readFile(hbaPath, "utf8");
      try {
        await writeFile(hbaPath, "host all all 127.0.0.1/32 trust\n");
        await expect(
          validateExistingCluster({
            toolchain: initialized.toolchain,
            placement: initialized.placement,
            expectedIdentity: expected,
            timeoutMs: 60_000,
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.cluster.identity_mismatch" },
        });
      } finally {
        await writeFile(hbaPath, original);
      }
    }, 120_000);

    const mismatches: readonly [
      string,
      (identity: PrivatePostgresExpectedIdentity) => PrivatePostgresExpectedIdentity,
    ][] = [
      ["major", (identity) => ({ ...identity, postgresMajor: 19 as never })],
      [
        "system identifier",
        (identity) => ({
          ...identity,
          clusterSystemIdentifier: "9999999999999999999",
        }),
      ],
      [
        "placement",
        (identity) => ({
          ...identity,
          placement: {
            ...identity.placement,
            relativePath: "other-cluster" as never,
          },
        }),
      ],
      [
        "persisted port",
        (identity) => ({
          ...identity,
          persistedPort: 55433,
          initializationProfileRevision:
            createPrivatePostgresInitializationProfileRevision(55433),
        }),
      ],
      [
        "initialization profile",
        (identity) => ({
          ...identity,
          initializationProfileRevision: asContentDigest(
            "PrivatePostgresInitializationProfileRevision",
            digestCanonicalJson("test.private-postgres-profile/mismatch", {
              profile: "mismatch",
            }),
          ),
        }),
      ],
    ];

    for (const [label, makeMismatch] of mismatches) {
      it(`rejects an existing cluster with a ${label} mismatch before start`, async () => {
        const before = await readFile(
          join(initialized.placement.canonicalDataDirectory, "PG_VERSION"),
          "utf8",
        );
        await expect(
          validateExistingCluster({
            toolchain: initialized.toolchain,
            placement: initialized.placement,
            expectedIdentity: makeMismatch(expected),
            timeoutMs: 60_000,
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.cluster.identity_mismatch" },
        });
        await expect(
          readFile(
            join(initialized.placement.canonicalDataDirectory, "PG_VERSION"),
            "utf8",
          ),
        ).resolves.toBe(before);
        await expect(
          access(join(initialized.placement.canonicalDataDirectory, "postmaster.pid")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      });
    }
  });

  describe("private PostgreSQL lifecycle", () => {
    async function createLifecycleCluster(port: number) {
      const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
      const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
      const logRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-log-"));
      const placement = resolvePrivatePostgresPlacement(dataRoot);
      const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
      const initialized = await initializePrivatePostgresCluster({
        toolchain,
        placement,
        credentialTempRoot: tempRoot,
        bootstrapPasswordUtf8: new TextEncoder().encode(
          "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
        ),
        port,
        lifecycle: {
          startupTimeoutMs: 60_000,
          shutdownTimeoutMs: 30_000,
          readinessPollIntervalMs: 100,
        },
        assertControlAuthority: allowControlAuthority,
      });
      const expected: PrivatePostgresExpectedIdentity = {
        installationId: createInstallationId(),
        instanceId: createInstanceId(),
        postgresMajor: 18,
        bootstrapRoleName: PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
        placement: {
          rootId: "DATA",
          relativePath: "private-postgres",
          dataLayoutVersion: 1,
        },
        persistedPort: port,
        clusterSystemIdentifier: initialized.identity.clusterSystemIdentifier,
        initializationProfileRevision: initialized.initializationProfileRevision,
      };
      return { dataRoot, tempRoot, logRoot, initialized, expected };
    }

    it("starts, becomes ready, stops, and restarts the same cluster", async () => {
      const cluster = await createLifecycleCluster(55433);
      const logFile = join(cluster.logRoot, "private-postgres.log");
      let ready: Awaited<ReturnType<typeof startPrivatePostgresCluster>> | undefined;

      try {
        ready = await startPrivatePostgresCluster({
          toolchain: cluster.initialized.toolchain,
          placement: cluster.initialized.placement,
          expectedIdentity: cluster.expected,
          logFilePath: logFile,
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority: allowControlAuthority,
        });
        expect(ready.port).toBe(55433);
        expect(ready.identity.clusterSystemIdentifier).toBe(
          cluster.initialized.identity.clusterSystemIdentifier,
        );
        await expect(access(logFile)).resolves.toBeUndefined();
        expect(logFile.startsWith(cluster.logRoot)).toBe(true);
        expect(logFile.startsWith(cluster.dataRoot)).toBe(false);

        await ready.stop();
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await ready.restart();

        expect(ready.port).toBe(55433);
        expect(ready.identity.clusterSystemIdentifier).toBe(
          cluster.initialized.identity.clusterSystemIdentifier,
        );
      } finally {
        await ready?.stop().catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);

    it("stops a process when readiness fails after start", async () => {
      const cluster = await createLifecycleCluster(55447);
      const brokenToolchain = {
        ...cluster.initialized.toolchain,
        pgIsReady: cluster.initialized.toolchain.pgControldata,
      };

      try {
        await expect(
          startPrivatePostgresCluster({
            toolchain: brokenToolchain,
            placement: cluster.initialized.placement,
            expectedIdentity: cluster.expected,
            logFilePath: join(cluster.logRoot, "private-postgres.log"),
            lifecycle: {
              startupTimeoutMs: 5_000,
              shutdownTimeoutMs: 30_000,
              readinessPollIntervalMs: 100,
            },
            assertControlAuthority: allowControlAuthority,
          }),
        ).rejects.toMatchObject({
          problem: {
            problemCode: expect.stringMatching(
              /^private-postgres\.lifecycle\.(process_exited|readiness_timeout)$/u,
            ),
          },
        });
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await runPostgresTool(
          cluster.initialized.toolchain.pgCtl,
          [
            "stop",
            "--pgdata",
            cluster.initialized.placement.canonicalDataDirectory,
            "--mode=fast",
            "--wait",
          ],
          { timeoutMs: 30_000 },
        ).catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);

    it("reports uncertain cleanup when control is lost after start", async () => {
      const cluster = await createLifecycleCluster(55448);
      let assertions = 0;
      const brokenToolchain = {
        ...cluster.initialized.toolchain,
        pgIsReady: cluster.initialized.toolchain.pgControldata,
      };
      const assertControlAuthority = () => {
        assertions += 1;
        if (assertions >= 3) throw new Error("authority revoked during cleanup");
      };

      try {
        await expect(
          startPrivatePostgresCluster({
            toolchain: brokenToolchain,
            placement: cluster.initialized.placement,
            expectedIdentity: cluster.expected,
            logFilePath: join(cluster.logRoot, "private-postgres.log"),
            lifecycle: {
              startupTimeoutMs: 5_000,
              shutdownTimeoutMs: 30_000,
              readinessPollIntervalMs: 100,
            },
            assertControlAuthority,
          }),
        ).rejects.toMatchObject({
          problem: {
            problemCode: "private-postgres.lifecycle.start_cleanup_uncertain",
          },
        });
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await runPostgresTool(
          cluster.initialized.toolchain.pgCtl,
          [
            "stop",
            "--pgdata",
            cluster.initialized.placement.canonicalDataDirectory,
            "--mode=fast",
            "--wait",
          ],
          { timeoutMs: 30_000 },
        ).catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);

    it("requires live control authority before start, stop, and restart", async () => {
      const cluster = await createLifecycleCluster(55446);
      let allowed = true;
      let ready: Awaited<ReturnType<typeof startPrivatePostgresCluster>> | undefined;
      const assertControlAuthority = () => {
        if (!allowed) throw new Error("authority revoked");
      };

      try {
        allowed = false;
        await expect(
          startPrivatePostgresCluster({
            toolchain: cluster.initialized.toolchain,
            placement: cluster.initialized.placement,
            expectedIdentity: cluster.expected,
            logFilePath: join(cluster.logRoot, "private-postgres.log"),
            lifecycle: {
              startupTimeoutMs: 60_000,
              shutdownTimeoutMs: 30_000,
              readinessPollIntervalMs: 100,
            },
            assertControlAuthority,
          }),
        ).rejects.toThrow("authority revoked");

        allowed = true;
        ready = await startPrivatePostgresCluster({
          toolchain: cluster.initialized.toolchain,
          placement: cluster.initialized.placement,
          expectedIdentity: cluster.expected,
          logFilePath: join(cluster.logRoot, "private-postgres.log"),
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority,
        });

        allowed = false;
        await expect(ready.stop()).rejects.toThrow("authority revoked");
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).resolves.toBeUndefined();
        await expect(ready.restart()).rejects.toThrow("authority revoked");
      } finally {
        allowed = true;
        await runPostgresTool(
          cluster.initialized.toolchain.pgCtl,
          [
            "stop",
            "--pgdata",
            cluster.initialized.placement.canonicalDataDirectory,
            "--mode=fast",
            "--wait",
          ],
          { timeoutMs: 30_000 },
        ).catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);

    it(
      "fails closed when an unrelated process occupies the persisted port",
      async () => {
        const cluster = await createLifecycleCluster(55434);
        const blocker = createServer();
        await new Promise<void>((resolve, reject) => {
          blocker.once("error", reject);
          blocker.listen(55434, "127.0.0.1", () => resolve());
        });

        try {
          await expect(
            startPrivatePostgresCluster({
              toolchain: cluster.initialized.toolchain,
              placement: cluster.initialized.placement,
              expectedIdentity: cluster.expected,
              logFilePath: join(cluster.logRoot, "private-postgres.log"),
              lifecycle: {
                startupTimeoutMs: 10_000,
                shutdownTimeoutMs: 30_000,
                readinessPollIntervalMs: 100,
              },
              assertControlAuthority: allowControlAuthority,
            }),
          ).rejects.toMatchObject({
            problem: {
              problemCode: "private-postgres.lifecycle.start_cleanup_uncertain",
            },
          });
          await expect(
            access(
              join(
                cluster.initialized.placement.canonicalDataDirectory,
                "postmaster.pid",
              ),
            ),
          ).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
          await new Promise<void>((resolve) => blocker.close(() => resolve()));
          await Promise.all(
            [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
              rm(root, { recursive: true, force: true }),
            ),
          );
        }
      },
      POSTGRES_INTEGRATION_TEST_TIMEOUT_MS,
    );

    it("reports an unexpected server exit instead of silently reinitializing", async () => {
      const cluster = await createLifecycleCluster(55435);
      let ready: Awaited<ReturnType<typeof startPrivatePostgresCluster>> | undefined;
      try {
        ready = await startPrivatePostgresCluster({
          toolchain: cluster.initialized.toolchain,
          placement: cluster.initialized.placement,
          expectedIdentity: cluster.expected,
          logFilePath: join(cluster.logRoot, "private-postgres.log"),
          lifecycle: {
            startupTimeoutMs: 60_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority: allowControlAuthority,
        });
        const stopped = await runPostgresTool(
          cluster.initialized.toolchain.pgCtl,
          [
            "stop",
            "--pgdata",
            cluster.initialized.placement.canonicalDataDirectory,
            "--mode=immediate",
            "--wait",
          ],
          { timeoutMs: 30_000 },
        );
        expect(stopped.exitCode).toBe(0);
        await expect(ready.restart()).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.lifecycle.restart_failed" },
        });
      } finally {
        await ready?.stop().catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);

    it("proves stopped after restart readiness failure instead of trusting STOPPED memory", async () => {
      const cluster = await createLifecycleCluster(55449);
      const profilePath = join(
        cluster.initialized.placement.canonicalDataDirectory,
        "postgresql.auto.conf",
      );
      const originalProfile = await readFile(profilePath, "utf8");
      let ready: Awaited<ReturnType<typeof startPrivatePostgresCluster>> | undefined;

      try {
        ready = await startPrivatePostgresCluster({
          toolchain: cluster.initialized.toolchain,
          placement: cluster.initialized.placement,
          expectedIdentity: cluster.expected,
          logFilePath: join(cluster.logRoot, "private-postgres.log"),
          lifecycle: {
            startupTimeoutMs: 5_000,
            shutdownTimeoutMs: 30_000,
            readinessPollIntervalMs: 100,
          },
          assertControlAuthority: allowControlAuthority,
        });
        await ready.stop();
        await writeFile(profilePath, `${originalProfile}port = 55450\n`);

        await expect(ready.restart()).rejects.toMatchObject({
          problem: { problemCode: "private-postgres.lifecycle.readiness_timeout" },
        });
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).resolves.toBeUndefined();

        await ready.stop();
        await expect(
          access(
            join(
              cluster.initialized.placement.canonicalDataDirectory,
              "postmaster.pid",
            ),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await writeFile(profilePath, originalProfile).catch(() => undefined);
        await runPostgresTool(
          cluster.initialized.toolchain.pgCtl,
          [
            "stop",
            "--pgdata",
            cluster.initialized.placement.canonicalDataDirectory,
            "--mode=immediate",
            "--wait",
          ],
          { timeoutMs: 30_000 },
        ).catch(() => undefined);
        await Promise.all(
          [cluster.dataRoot, cluster.tempRoot, cluster.logRoot].map((root) =>
            rm(root, { recursive: true, force: true }),
          ),
        );
      }
    }, 120_000);
  });
});
