// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOsCredentialStore } from "../../../packages/system/os-credential/dist/index.js";

import { observeRunningHost, type RunningHost } from "../support/running-host.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeExecutableName = process.platform === "win32" ? "node.exe" : "bin/node";
const launcherName = process.platform === "win32" ? "heptalogos.cmd" : "heptalogos";
const comspec =
  process.env.ComSpec ??
  process.env.COMSPEC ??
  (process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh");

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function commandQuote(value: string): string {
  return /[\s&|<>^]/u.test(value) ? '"' + value + '"' : value;
}

function commandLine(executable: string, args: readonly string[]): string {
  return [commandQuote(executable), ...args.map(commandQuote)].join(" ");
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "LANG",
    "LANGUAGE",
    "TERM",
    "COLORTERM",
    "TZ",
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (environment.HOME === undefined && environment.USERPROFILE !== undefined) {
    environment.HOME = environment.USERPROFILE;
  }
  if (process.platform === "win32") {
    environment.Path = join(environment.SystemRoot ?? "C:\\Windows", "System32");
  } else {
    environment.PATH = "/usr/bin:/bin";
  }
  return environment;
}

// Intentional duplication: portable qualification captures arbitrary launcher
// commands, while the support helper owns the Product CLI's fixed invocation.
/* jscpd:ignore-start */
function runCommand(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly input?: string;
  },
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
/* jscpd:ignore-end */

async function runChecked(
  executable: string,
  args: readonly string[],
  cwd: string,
  env = process.env,
): Promise<string> {
  const result = await runCommand(executable, args, { cwd, env });
  if (result.code !== 0) {
    fail(
      executable +
        " " +
        args.join(" ") +
        " failed (" +
        result.code +
        "): " +
        (result.stderr || result.stdout),
    );
  }
  return result.stdout;
}

async function portableCliRaw(
  root: string,
  args: readonly string[],
  input?: string,
): Promise<CommandResult> {
  const launcher = join(root, "bin", launcherName);
  const command = commandLine(launcher, args);
  const shellArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return runCommand(comspec, shellArgs, {
    cwd: root,
    env: safeEnvironment(),
    input,
  });
}

async function portableCli(
  root: string,
  args: readonly string[],
  input?: string,
): Promise<Record<string, any>> {
  const result = await portableCliRaw(root, args, input);
  if (result.code !== 0) {
    fail(
      "Portable CLI failed (" +
        args.join(" ") +
        "): " +
        (result.stderr || result.stdout),
    );
  }
  try {
    return JSON.parse(result.stdout) as Record<string, any>;
  } catch (error) {
    fail(
      "Portable CLI did not return JSON (" +
        args.join(" ") +
        "): " +
        String(error) +
        "; " +
        result.stdout,
    );
  }
}

async function readLocator(root: string): Promise<Record<string, any>> {
  return JSON.parse(
    await readFile(join(root, "heptalogos.bootstrap.json"), "utf8"),
  ) as Record<string, any>;
}

async function endpointOrigin(locator: Record<string, any>): Promise<string> {
  const endpoint = JSON.parse(
    await readFile(join(locator.roots.RUN, "management-endpoint.json"), "utf8"),
  ) as Record<string, unknown>;
  assertCondition(
    typeof endpoint.origin === "string",
    "Management endpoint descriptor is invalid",
  );
  return endpoint.origin;
}

async function requestJson(
  origin: string,
  path: string,
  options: RequestInit = {},
): Promise<{ readonly response: Response; readonly body: Record<string, any> }> {
  const response = await fetch(origin + path, options);
  return { response, body: (await response.json()) as Record<string, any> };
}

async function startPortableHost(root: string, nodeRoot: string): Promise<RunningHost> {
  const launcher = join(root, "bin", "portable-launcher.mjs");
  const child = spawn(join(nodeRoot, nodeExecutableName), [launcher, "start"], {
    cwd: root,
    env: safeEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.end();
  return observeRunningHost(child);
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string | (() => string),
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(typeof message === "function" ? message() : message);
}

async function processExists(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPortablePostgres(root: string, pid: number): Promise<void> {
  if (!(await processExists(pid))) return;
  const dataDirectory = join(root, "data", "private-postgres");
  const pgctl = join(
    root,
    "runtime",
    "postgresql",
    "bin",
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
  );
  const result = await runCommand(
    pgctl,
    ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
    { cwd: root, env: safeEnvironment() },
  );
  if (result.code !== 0) {
    fail(
      "Bundled PostgreSQL stop failed (" +
        result.code +
        "): " +
        (result.stderr || result.stdout),
    );
  }
}

async function findRuntimeRoots(): Promise<{
  readonly nodeRoot: string;
  readonly postgresRoot: string;
}> {
  const nodeRootOverride = process.env.HEPTALOGOS_PORTABLE_NODE_ROOT;
  const postgresRootOverride = process.env.HEPTALOGOS_PORTABLE_POSTGRES_ROOT;
  const stageRoot =
    nodeRootOverride === undefined
      ? await (async () => {
          const entries = await readdir(join(repositoryRoot, "tmp"), {
            withFileTypes: true,
          });
          const candidates = entries
            .filter(
              (entry) => entry.isDirectory() && /^p4-portable-stage-/u.test(entry.name),
            )
            .map((entry) => join(repositoryRoot, "tmp", entry.name, "runtime", "node"))
            .sort()
            .reverse();
          return candidates[0];
        })()
      : undefined;
  const nodeRoot = nodeRootOverride ?? stageRoot;
  const postgresRoot =
    postgresRootOverride ?? resolve(repositoryRoot, "tmp/pg/extracted/pgsql");
  assertCondition(
    nodeRoot !== undefined,
    "Portable Node runtime root is not available",
  );
  await access(join(nodeRoot, nodeExecutableName));
  await access(
    join(
      postgresRoot,
      "bin",
      process.platform === "win32" ? "postgres.exe" : "postgres",
    ),
  );
  return { nodeRoot, postgresRoot };
}

async function assembleCandidate(
  nodeRoot: string,
  postgresRoot: string,
  workspaceStatus: string,
): Promise<{ readonly assemblyRoot: string; readonly candidateRoot: string }> {
  const parent = await mkdtemp(join(tmpdir(), "heptalogos-portable-qualification-"));
  const assemblyRoot = join(parent, "assembled");
  const candidateRoot = join(parent, "candidate");
  await runChecked(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
      "--target",
      assemblyRoot,
      "--host-artifact",
      resolve(repositoryRoot, "packages/application/product-host/dist"),
      "--cli-artifact",
      resolve(repositoryRoot, "packages/application/cli/dist"),
      "--node-root",
      nodeRoot,
      "--postgres-root",
      postgresRoot,
    ],
    repositoryRoot,
  );
  const assembledManifest = JSON.parse(
    await readFile(join(assemblyRoot, "manifest.json"), "utf8"),
  ) as { readonly productGeneration: string };
  const assembledProductRoot = join(
    assemblyRoot,
    "program",
    "product",
    assembledManifest.productGeneration,
  );
  await mkdir(join(assemblyRoot, "config"), { recursive: true });
  await writeFile(join(assemblyRoot, "config", "incremental-marker.txt"), "preserve\n");
  const stablePaths = [
    join(assemblyRoot, "runtime", "node", nodeExecutableName),
    join(
      assemblyRoot,
      "runtime",
      "postgresql",
      "bin",
      process.platform === "win32" ? "postgres.exe" : "postgres",
    ),
    join(assembledProductRoot, "bin.js"),
  ];
  const beforeIncremental = await Promise.all(stablePaths.map((path) => lstat(path)));
  const incrementalArgs = [
    resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
    "--target",
    assemblyRoot,
    "--incremental",
    "--host-artifact",
    resolve(repositoryRoot, "packages/application/product-host/dist"),
    "--cli-artifact",
    resolve(repositoryRoot, "packages/application/cli/dist"),
    "--node-root",
    nodeRoot,
    "--postgres-root",
    postgresRoot,
  ];
  const incrementalOutput = await runChecked(
    process.execPath,
    incrementalArgs,
    repositoryRoot,
  );
  expect(incrementalOutput).toContain("PASS portable Product unchanged");
  const afterIncremental = await Promise.all(stablePaths.map((path) => lstat(path)));
  expect(afterIncremental.map((entry) => entry.mtimeMs)).toEqual(
    beforeIncremental.map((entry) => entry.mtimeMs),
  );
  await expect(
    readFile(join(assemblyRoot, "config", "incremental-marker.txt"), "utf8"),
  ).resolves.toBe("preserve\n");
  const providerPath = join(
    assembledProductRoot,
    "node_modules/@heptalogos/canonical-schema/dist/migration-provider.js",
  );
  const correctProvider = await readFile(providerPath, "utf8");
  await writeFile(providerPath, 'export const canonicalMigrationNames = ["0017"];\n');
  // Input keys are unchanged: payload drift must trigger a real replacement,
  // never a new manifest digest blessing the stale dependency bytes.
  await runChecked(process.execPath, incrementalArgs, repositoryRoot);
  expect(await readFile(providerPath, "utf8")).toBe(correctProvider);
  expect(
    JSON.parse(await readFile(join(assemblyRoot, "manifest.json"), "utf8"))
      .schemaVersion,
  ).toBe(2);
  await rename(assemblyRoot, candidateRoot);
  const afterStatus = await runChecked(
    "git",
    ["status", "--porcelain"],
    repositoryRoot,
  );
  expect(afterStatus).toBe(workspaceStatus);
  return { assemblyRoot, candidateRoot };
}

describe.skipIf(process.platform !== "win32" || process.arch !== "x64")(
  "Windows portable Management qualification",
  () => {
    it(
      "runs the copied Management artifact through protected login, configuration and foreground restart",
      { timeout: 900_000 },
      async () => {
        const workspaceStatus = await runChecked(
          "git",
          ["status", "--porcelain"],
          repositoryRoot,
        );
        const { nodeRoot, postgresRoot } = await findRuntimeRoots();
        let assemblyRoot: string | undefined;
        let candidateRoot: string | undefined;
        let host: RunningHost | undefined;
        let installationId: string | undefined;
        try {
          ({ assemblyRoot, candidateRoot } = await assembleCandidate(
            nodeRoot,
            postgresRoot,
            workspaceStatus,
          ));
          const manifest = JSON.parse(
            await readFile(join(candidateRoot, "manifest.json"), "utf8"),
          );
          expect(manifest.target).toEqual({ os: "win32", arch: "x64" });
          expect(manifest.gateways.subject.state).toBe("unconfigured");
          expect(manifest.gateways.maintenance.state).toBe("unconfigured");
          const privateNodeRoot = join(candidateRoot, "runtime", "node");
          expect(
            (
              await runChecked(
                join(privateNodeRoot, nodeExecutableName),
                ["--version"],
                candidateRoot,
              )
            ).trim(),
          ).toBe("v24.21.0");
          host = await startPortableHost(candidateRoot, privateNodeRoot);
          const locator = await readLocator(candidateRoot);
          installationId = locator.installationId;
          const origin = await endpointOrigin(locator);
          expect((await requestJson(origin, "/v1/status")).response.status).toBe(401);
          const password = "Portable-management-qualification-2026!";
          const claimed = await portableCli(
            candidateRoot,
            ["admin", "claim", "--password-stdin", "--json"],
            password + "\n",
          );
          expect(claimed.administratorId).toBeTypeOf("string");
          const loggedIn = await portableCli(
            candidateRoot,
            ["auth", "login", "--password-stdin", "--json"],
            password + "\n",
          );
          expect(loggedIn.authenticated).toBe(true);
          const settings = {
            nous: {
              runRoot: join(locator.roots.RUN, "not-installed-nous"),
              expectedInstanceId: null,
            },
            subject: { id: null, enabled: false },
            subjectGateway: { origin: "http://127.0.0.1:1" },
            maintenanceGateway: { origin: "http://127.0.0.1:2" },
          };
          const configured = await portableCli(
            candidateRoot,
            ["config", "set", "--stdin", "--json"],
            JSON.stringify(settings),
          );
          expect(configured.revision).toBeTypeOf("string");
          const status = await portableCli(candidateRoot, ["status", "--json"]);
          expect(status.management).toBe("available");
          expect(status.subject).toEqual({ id: null, enabled: false });
          const firstBoot = host.ready.bootId;
          const postgresPid = Number(
            (
              await readFile(
                join(locator.roots.DATA, "private-postgres", "postmaster.pid"),
                "utf8",
              )
            ).split(/\r?\n/u)[0],
          );
          await host.stop();
          host = undefined;
          await stopPortablePostgres(candidateRoot, postgresPid);
          await waitFor(
            async () => !(await processExists(postgresPid)),
            "Private PostgreSQL did not stop",
          );
          host = await startPortableHost(candidateRoot, privateNodeRoot);
          expect(host.ready.installationId).toBe(installationId);
          expect(host.ready.bootId).not.toBe(firstBoot);
          expect(await portableCli(candidateRoot, ["config", "get", "--json"])).toEqual(
            configured,
          );
          expect(
            (await portableCli(candidateRoot, ["auth", "logout", "--json"]))
              .authenticated,
          ).toBe(false);
          console.log(
            JSON.stringify({
              type: "PASS",
              qualification: "portable-management",
              platform: "windows-x64",
              installationId,
              protectedLogin: true,
              configurationPersisted: true,
              gatewayState: "unconfigured",
            }),
          );
        } finally {
          await host?.stop();
          if (candidateRoot) {
            const locator = await readLocator(candidateRoot).catch(() => undefined);
            if (locator) {
              const pidFile = await readFile(
                join(locator.roots.DATA, "private-postgres", "postmaster.pid"),
                "utf8",
              ).catch(() => "");
              await stopPortablePostgres(
                candidateRoot,
                Number(pidFile.split(/\r?\n/u)[0]),
              );
            }
          }
          if (installationId) {
            const store = createOsCredentialStore();
            for (const account of [
              "bootstrap/private-postgres-bootstrap-superuser",
              "bootstrap/private-postgres-host-lease-role",
              "bootstrap/private-postgres-runtime-role",
              "bootstrap/private-postgres-migration-role",
              "bootstrap/private-postgres-durable-execution-role",
              "management/current-administrator-session",
            ]) {
              await store
                .delete({ service: "Heptalogos/" + installationId, account })
                .catch(() => undefined);
            }
          }
          if (assemblyRoot)
            await rm(dirname(assemblyRoot), { recursive: true, force: true });
        }
      },
    );
  },
);
