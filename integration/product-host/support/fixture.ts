// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createInstallationId,
  createInstanceId,
  LIFECYCLE_ROOT_IDS,
} from "@heptalogos/foundation-contracts";
import {
  createOsCredentialStore,
  type OsCredentialStore,
} from "@heptalogos/os-credential";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hostBinary = resolve(
  repositoryRoot,
  "packages/application/product-host/dist/bin.js",
);
const cliBinary = resolve(repositoryRoot, "packages/application/cli/dist/bin.js");
const execFileAsync = promisify(execFile);

async function stopFixturePrivatePostgres(
  postgresBin: string,
  dataDirectory: string,
): Promise<void> {
  const pgCtl = resolve(
    postgresBin,
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
  );
  await execFileAsync(
    pgCtl,
    ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
    { windowsHide: true, timeout: 120_000 },
  ).catch(() => undefined);
}

/** Test-only isolated installation roots; Product Host still owns composition. */
export interface ProductHostFixture {
  readonly anchorRoot: string;
  readonly roots: Readonly<Record<(typeof LIFECYCLE_ROOT_IDS)[number], string>>;
  readonly installationId: ReturnType<typeof createInstallationId>;
  readonly instanceId: ReturnType<typeof createInstanceId>;
  readonly postgresBin: string;
  readonly postgresPort: number;
  readonly credentialStore: OsCredentialStore;
  readonly runRoot: string;
  cleanup(): Promise<void>;
}

export interface HostReady {
  readonly type: "READY";
  readonly installationId: string;
  readonly instanceId: string;
  readonly bootId: string;
  readonly origin: string;
  readonly productGeneration: string;
  readonly bootstrapRuntimeGeneration: string;
}

export interface RunningHost {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: HostReady;
  readonly stop: () => Promise<void>;
  readonly crash: () => Promise<void>;
  readonly stderr: () => string;
}

// Intentional duplication: this fixture allocates its PostgreSQL test port
// with Product Host-specific failure semantics; the production Subject
// Gateway allocator is a separate owner and must report cognition Problems.
/* jscpd:ignore-start */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    throw new Error("Could not allocate a Product Host PostgreSQL port");
  }
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return port;
}
/* jscpd:ignore-end */

// Intentional duplication: this in-process Product Host fixture materializes
// lifecycle roots independently from the Foundation PostgreSQL fixture.
/* jscpd:ignore-start */
export async function makeFixture(postgresBin: string): Promise<ProductHostFixture> {
  const anchorRoot = await mkdtemp(join(tmpdir(), "heptalogos-product-host-anchor-"));
  const fixtureDirectories = [anchorRoot];
  const roots = {} as Record<(typeof LIFECYCLE_ROOT_IDS)[number], string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(join(tmpdir(), `heptalogos-product-host-${id.toLowerCase()}-`));
    if (id !== "PROGRAM") fixtureDirectories.push(roots[id]);
  }
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({ schemaVersion: 1, installationId, instanceId, roots }),
    "utf8",
  );
  /* jscpd:ignore-end */
  const credentialStore = createOsCredentialStore();
  const fixture: ProductHostFixture = {
    anchorRoot,
    roots,
    installationId,
    instanceId,
    postgresBin,
    postgresPort: await freePort(),
    credentialStore,
    runRoot: roots.RUN,
    async cleanup() {
      const accounts = [
        "bootstrap/private-postgres-bootstrap-superuser",
        "bootstrap/private-postgres-host-lease-role",
        "bootstrap/private-postgres-runtime-role",
        "bootstrap/private-postgres-migration-role",
        "bootstrap/private-postgres-durable-execution-role",
        "management/current-administrator-session",
      ];
      await Promise.all(
        accounts.map((account) =>
          credentialStore
            .delete({ service: "Heptalogos/" + installationId, account })
            .catch(() => false),
        ),
      );
      await stopFixturePrivatePostgres(
        postgresBin,
        join(roots.DATA, "private-postgres"),
      );
      await Promise.all(
        fixtureDirectories.map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    },
  };
  return fixture;
}

export async function runHost(
  fixture: ProductHostFixture,
  options: { readonly includeInitialPort?: boolean } = {},
): Promise<RunningHost> {
  const args = [
    hostBinary,
    "--anchor-root",
    fixture.anchorRoot,
    "--postgres-bin",
    fixture.postgresBin,
  ];
  if (options.includeInitialPort !== false) {
    args.push("--initial-postgres-port", String(fixture.postgresPort));
  }
  const child = spawn(process.execPath, args, {
    cwd: fixture.roots.CACHE,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.end();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const stdoutReader = createInterface({ input: child.stdout });
  const stderrReader = createInterface({ input: child.stderr });
  const ready = await new Promise<HostReady>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Product Host did not publish READY: " + stderr));
      child.kill();
    }, 150_000);
    const inspectLine = (line: string, stream: "stdout" | "stderr") => {
      try {
        const value = JSON.parse(line) as Partial<HostReady>;
        if (value.type === "READY") {
          clearTimeout(timer);
          resolvePromise(value as HostReady);
        } else if (value.type === "ERROR") {
          clearTimeout(timer);
          reject(
            new Error(
              `Product Host startup failed on ${stream}: ${line}${stderr.length === 0 ? "" : `; stderr=${stderr}`}`,
            ),
          );
        }
      } catch {
        // Keep waiting for the machine-readable READY line.
      }
    };
    stdoutReader.on("line", (line) => inspectLine(line, "stdout"));
    stderrReader.on("line", (line) => inspectLine(line, "stderr"));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Product Host exited before READY (${code}): ${stderr}`));
    });
  });
  stdoutReader.close();
  stderrReader.close();
  return {
    child,
    ready,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Product Host did not stop")),
          60_000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          resolvePromise();
        });
      });
    },
    async crash() {
      if (child.exitCode !== null) return;
      child.kill("SIGKILL");
      await new Promise<void>((resolvePromise) => {
        child.once("exit", () => resolvePromise());
      });
    },
  };
}

export async function runCli(
  fixture: ProductHostFixture,
  args: readonly string[],
  input?: string,
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = spawn(
    process.execPath,
    [cliBinary, ...args, "--anchor-root", fixture.anchorRoot],
    {
      cwd: fixture.roots.CACHE,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(input);
  const code = await new Promise<number>((resolvePromise) => {
    child.once("exit", (exitCode) => resolvePromise(exitCode ?? 1));
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

export async function readRunJson(
  fixture: ProductHostFixture,
  filename: string,
): Promise<unknown> {
  return JSON.parse(await readFile(join(fixture.runRoot, filename), "utf8")) as unknown;
}
