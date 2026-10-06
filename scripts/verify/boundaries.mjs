// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Verifies Heptalogos-specific package boundary and Authority leakage rules
 * that generic dependency analyzers cannot express as semantic invariants.
 * @module boundaries
 */

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRepositoryFilesSync } from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const errors = [];
const workQueuePublicSource = readFileSync(
  resolve(root, "packages/execution/work-queue/src/index.ts"),
  "utf8",
);
if (/\bcreateWorkQueueRepository\b/u.test(workQueuePublicSource)) {
  errors.push(
    "packages/execution/work-queue/src/index.ts: concrete WorkQueue repository factory must remain on the restricted Foundation subpath",
  );
}

const hostOwnershipSourcePrefix = "packages/bootstrap/host-ownership/src/";
const hostOwnershipPublicSource = readFileSync(
  resolve(root, "packages/bootstrap/host-ownership/src/index.ts"),
  "utf8",
);
if (/\b(?:Client|Pool|XState|StateMachine)\b/u.test(hostOwnershipPublicSource)) {
  errors.push(
    "packages/bootstrap/host-ownership/src/index.ts: raw PostgreSQL/XState mechanics must not leak through the public Host ownership contract",
  );
}

const bootstrapRuntimePublicSource = readFileSync(
  resolve(root, "packages/bootstrap/bootstrap-runtime/src/index.ts"),
  "utf8",
);
const rawBootstrapAuthorityExports = [
  "acquireBootstrapOwnership",
  "acquireBootstrapRecoveryLease",
  "reclaimAbandonedBootstrapOwnership",
  "recoverAbandonedBootstrapToHost",
  "recoverInterruptedHostMaintenance",
  "openMaintenanceStateAccess",
  "OwnedMaintenanceStateAccess",
  "BOOTSTRAP_RECOVERY_STALE_MS",
  "assertLocalInstallationOwnerFor",
];
const sensitiveBootstrapAuthorityModules = [
  "./bootstrap/ownership.js",
  "./recovery/bootstrap.js",
  "./maintenance/recovery.js",
  "./maintenance/state-access.js",
];
if (
  rawBootstrapAuthorityExports.some((name) =>
    new RegExp(`\\b${name}\\b`, "u").test(bootstrapRuntimePublicSource),
  )
) {
  errors.push(
    "packages/bootstrap/bootstrap-runtime/src/index.ts: raw bootstrap/recovery Authority primitive leaked through the public bootstrap-runtime contract",
  );
}

const persistencePublicSourcePath = resolve(
  root,
  "packages/data/persistence/src/index.ts",
);
const persistencePublicSource = readFileSync(persistencePublicSourcePath, "utf8");
const persistenceMechanicsPattern =
  /\b(?:Pool|PoolClient|Client|Kysely|PostgresDialect|Transaction|CompiledQuery)\b/u;
if (persistenceMechanicsPattern.test(persistencePublicSource)) {
  errors.push(
    "packages/data/persistence/src/index.ts: concrete pg/Kysely mechanics must not leak through the persistence package root",
  );
}
const executionLineagePublicSourcePath = resolve(
  root,
  "packages/execution/execution-lineage/src/index.ts",
);
const executionLineagePublicSource = readFileSync(
  executionLineagePublicSourcePath,
  "utf8",
);
const executionLineageMechanicsPattern =
  /\b(?:AsyncLocalStorage|OTelContext|SpanContext|TracerProvider|ContextManager|Kysely|Pool|Client|PersistenceInternalTransaction|runWithLineageSuppressed)\b/u;
if (executionLineageMechanicsPattern.test(executionLineagePublicSource)) {
  errors.push(
    "packages/execution/execution-lineage/src/index.ts: ALS/OTel provider/raw persistence/suppression mechanics must not leak through the execution-lineage package root",
  );
}

const evidencePublicSourcePath = resolve(
  root,
  "packages/execution/evidence/src/index.ts",
);
const evidencePublicSource = readFileSync(evidencePublicSourcePath, "utf8");
const evidenceMechanicsPattern =
  /\b(?:Pool|PoolClient|Client|Kysely|PostgresDialect|CompiledQuery|PersistenceInternalTransaction)\b/u;
const evidenceGenericPayloadPattern =
  /\b(?:metadata|payload)\s*[?:]|Record\s*<\s*string\s*,\s*unknown\s*>/u;
if (evidenceMechanicsPattern.test(evidencePublicSource)) {
  errors.push(
    "packages/execution/evidence/src/index.ts: concrete pg/Kysely/persistence mechanics must not leak through the evidence package root",
  );
}
if (evidenceGenericPayloadPattern.test(evidencePublicSource)) {
  errors.push(
    "packages/execution/evidence/src/index.ts: generic evidence payload/metadata must not leak through the evidence package root",
  );
}

const canonicalSchemaPublicSourcePath = resolve(
  root,
  "packages/data/canonical-schema/src/index.ts",
);
const canonicalSchemaPublicSource = readFileSync(
  canonicalSchemaPublicSourcePath,
  "utf8",
);
const canonicalSchemaMechanicsPattern =
  /\b(?:Pool|PoolClient|Client|Kysely|PostgresDialect|Migrator|MigrationProvider)\b/u;
if (canonicalSchemaMechanicsPattern.test(canonicalSchemaPublicSource)) {
  errors.push(
    "packages/data/canonical-schema/src/index.ts: concrete pg/Kysely migration mechanics must not leak through the canonical-schema package root",
  );
}
if (
  sensitiveBootstrapAuthorityModules.some((specifier) =>
    new RegExp(`export\\s+\\*\\s+from\\s+["']${specifier}["']`, "u").test(
      bootstrapRuntimePublicSource,
    ),
  )
) {
  errors.push(
    "packages/bootstrap/bootstrap-runtime/src/index.ts: sensitive bootstrap/recovery Authority module exported through a package-root star export",
  );
}

const sourcePaths = findRepositoryFilesSync({
  root,
  patterns: ["packages/**/*.ts", "packages/**/*.tsx"],
  ignore: ["**/dist/**", "**/node_modules/**", "**/.nx/**", "**/coverage/**"],
});
for (const path of sourcePaths) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  const source = readFileSync(path, "utf8");
  if (
    source.includes("createHostOwnershipToken") &&
    !(
      relativePath === "packages/foundation/foundation-contracts/src/identity.ts" ||
      relativePath === "packages/foundation/foundation-contracts/src/index.ts" ||
      relativePath.startsWith(hostOwnershipSourcePrefix) ||
      relativePath === "packages/bootstrap/bootstrap-runtime/src/host/handoff.ts" ||
      relativePath.endsWith(".test.ts")
    )
  ) {
    errors.push(
      `${relativePath}: HostOwnershipToken creation is outside the Host acquisition path`,
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "PASS Heptalogos semantic boundary checks; package tooling identity and public Authority surfaces are valid",
  );
}
