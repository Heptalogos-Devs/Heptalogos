// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads and validates private PostgreSQL cluster identity/readiness evidence so
 * Bootstrap can reject an unexpected data directory before starting it.
 * @module cluster-inspection
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import {
  PRIVATE_POSTGRES_ARCHITECTURE_MAJOR,
  type PrivatePostgresToolchain,
} from "./contracts.js";
import { runPostgresTool } from "./process-adapter.js";

/** Parsed deterministic fields emitted by `pg_controldata`. */
export interface ParsedPgControldata {
  readonly clusterSystemIdentifier: string;
  readonly databaseClusterState: string;
  readonly catalogVersionNumber: string;
  readonly dataPageChecksumVersion: number;
}

/** Combines PostgreSQL major identity with parsed control metadata. */
export interface PrivatePostgresClusterInspection extends ParsedPgControldata {
  readonly postgresMajor: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
}

function inspectionProblem(
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

function field(output: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*${escapedLabel}:\\s*(.*?)\\s*$`, "mu").exec(output);
  if (!match || match[1].length === 0) {
    throw inspectionProblem(
      "private-postgres.cluster.control_data_invalid",
      "PostgreSQL control data is incomplete",
      "The PostgreSQL control metadata did not contain the required deterministic fields",
    );
  }
  return match[1];
}

/** Parses and validates the control-data fields required by Bootstrap. */
export function parsePgControldata(output: string): ParsedPgControldata {
  const clusterSystemIdentifier = field(output, "Database system identifier");
  if (!/^[0-9]+$/u.test(clusterSystemIdentifier)) {
    throw inspectionProblem(
      "private-postgres.cluster.control_data_invalid",
      "PostgreSQL system identifier is invalid",
      "The PostgreSQL system identifier must be a non-empty decimal string",
    );
  }

  const databaseClusterState = field(output, "Database cluster state");
  const catalogVersionNumber = field(output, "Catalog version number");
  if (!/^[0-9]+$/u.test(catalogVersionNumber)) {
    throw inspectionProblem(
      "private-postgres.cluster.control_data_invalid",
      "PostgreSQL catalog version is invalid",
      "The PostgreSQL catalog version must be a decimal diagnostic value",
    );
  }

  const checksumText = field(output, "Data page checksum version");
  if (!/^[0-9]+$/u.test(checksumText)) {
    throw inspectionProblem(
      "private-postgres.cluster.control_data_invalid",
      "PostgreSQL checksum metadata is invalid",
      "The PostgreSQL data page checksum version must be a decimal value",
    );
  }

  return Object.freeze({
    clusterSystemIdentifier,
    databaseClusterState,
    catalogVersionNumber,
    dataPageChecksumVersion: Number(checksumText),
  });
}

/** Reads and validates the supported PostgreSQL major from PG_VERSION. */
export async function readPrivatePostgresMajor(
  dataDirectory: string,
): Promise<typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR> {
  if (!isAbsolute(dataDirectory)) {
    throw inspectionProblem(
      "private-postgres.cluster.pg_version_mismatch",
      "PostgreSQL data directory is not absolute",
      "The PostgreSQL data directory must be an absolute validated path",
      "validation",
    );
  }

  let versionText: string;
  try {
    versionText = await readFile(join(dataDirectory, "PG_VERSION"), "utf8");
  } catch {
    throw inspectionProblem(
      "private-postgres.cluster.pg_version_mismatch",
      "PostgreSQL PG_VERSION is unavailable",
      "The PostgreSQL cluster does not expose a readable PG_VERSION file",
    );
  }

  if (versionText.trim() !== String(PRIVATE_POSTGRES_ARCHITECTURE_MAJOR)) {
    throw inspectionProblem(
      "private-postgres.cluster.pg_version_mismatch",
      "PostgreSQL cluster major is not supported",
      `The PostgreSQL cluster must report architecture major ${PRIVATE_POSTGRES_ARCHITECTURE_MAJOR} in PG_VERSION`,
    );
  }
  return PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
}

/** Inspects a private cluster with pg_controldata after major validation. */
export async function inspectPrivatePostgresCluster(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
  options: { readonly timeoutMs: number },
): Promise<PrivatePostgresClusterInspection> {
  const postgresMajor = await readPrivatePostgresMajor(dataDirectory);
  const result = await runPostgresTool(
    toolchain.pgControldata,
    [dataDirectory],
    options,
  );
  if (result.exitCode !== 0) {
    throw inspectionProblem(
      "private-postgres.cluster.control_data_failed",
      "PostgreSQL control metadata inspection failed",
      "pg_controldata did not complete successfully for the validated cluster",
      "unavailable",
    );
  }
  return Object.freeze({ postgresMajor, ...parsePgControldata(result.stdout) });
}
