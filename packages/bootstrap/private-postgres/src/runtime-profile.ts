// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads and writes the canonical private PostgreSQL runtime profile so startup
 * uses one validated HBA and server configuration projection.
 * @module runtime-profile
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import type { PrivatePostgresToolchain } from "./contracts.js";
import { runPostgresTool } from "./process-adapter.js";
import { assertPrivatePostgresPort } from "./port.js";

/** Reports the effective private PostgreSQL profile read from the cluster. */
export interface EffectivePrivatePostgresProfile {
  readonly listenAddress: string;
  readonly unixSocketDirectories: string;
  readonly port: number;
  readonly passwordEncryption: string;
  readonly dataDirectory: string;
  readonly hbaFile: string;
}

function profileProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

/** Renders the canonical runtime configuration for a private cluster. */
export function createCanonicalRuntimeProfile(port: number): string {
  assertPrivatePostgresPort(port);
  return [
    "listen_addresses = '127.0.0.1'",
    "unix_socket_directories = ''",
    `port = ${port}`,
    "password_encryption = 'scram-sha-256'",
    "",
  ].join("\n");
}

/** Renders the canonical HBA policy for loopback SCRAM authentication. */
export function createCanonicalHbaProfile(): string {
  return [
    "# Heptalogos private PostgreSQL HBA profile v1",
    "host all all 127.0.0.1/32 scram-sha-256",
    "",
  ].join("\n");
}

/** Writes the canonical runtime profile and HBA configuration atomically. */
export async function writeCanonicalPrivatePostgresRuntimeProfile(
  dataDirectory: string,
  port: number,
): Promise<void> {
  try {
    await writeFile(
      join(dataDirectory, "postgresql.auto.conf"),
      createCanonicalRuntimeProfile(port),
      { mode: 0o600 },
    );
    await writeFile(join(dataDirectory, "pg_hba.conf"), createCanonicalHbaProfile(), {
      mode: 0o600,
    });
  } catch {
    throw profileProblem(
      "private-postgres.cluster.profile_write_failed",
      "Private PostgreSQL runtime profile could not be written",
      "The owned PostgreSQL runtime and HBA profiles could not be materialized in the initialized cluster",
      "unavailable",
    );
  }
}

async function queryEffectiveSetting(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
  setting: string,
  timeoutMs: number,
): Promise<string> {
  const result = await runPostgresTool(
    toolchain.postgres,
    ["-D", dataDirectory, "-C", setting],
    { timeoutMs },
  );
  if (result.exitCode !== 0) {
    throw profileProblem(
      "private-postgres.cluster.effective_setting_failed",
      "PostgreSQL effective setting inspection failed",
      `PostgreSQL could not report the effective ${setting} setting`,
      "unavailable",
    );
  }
  const value = result.stdout.trim();
  if (value.length === 0 && setting !== "unix_socket_directories") {
    throw profileProblem(
      "private-postgres.cluster.effective_setting_invalid",
      "PostgreSQL effective setting is empty",
      `PostgreSQL reported an empty effective ${setting} setting`,
    );
  }
  return value;
}

/** Reads the effective profile values needed for identity qualification. */
export async function inspectEffectivePrivatePostgresProfile(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
  timeoutMs: number,
): Promise<EffectivePrivatePostgresProfile> {
  const listenAddress = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "listen_addresses",
    timeoutMs,
  );
  const unixSocketDirectories = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "unix_socket_directories",
    timeoutMs,
  );
  const portText = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "port",
    timeoutMs,
  );
  const port = Number(portText);
  assertPrivatePostgresPort(port);
  const passwordEncryption = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "password_encryption",
    timeoutMs,
  );
  const dataDirectorySetting = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "data_directory",
    timeoutMs,
  );
  const hbaFile = await queryEffectiveSetting(
    toolchain,
    dataDirectory,
    "hba_file",
    timeoutMs,
  );

  return Object.freeze({
    listenAddress,
    unixSocketDirectories,
    port,
    passwordEncryption,
    dataDirectory: dataDirectorySetting,
    hbaFile,
  });
}

/** Reads and validates the canonical HBA profile text. */
export async function readCanonicalHbaProfile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw profileProblem(
      "private-postgres.cluster.hba_profile_missing",
      "Private PostgreSQL HBA profile is missing",
      "The authoritative private PostgreSQL HBA profile could not be read",
    );
  }
}
