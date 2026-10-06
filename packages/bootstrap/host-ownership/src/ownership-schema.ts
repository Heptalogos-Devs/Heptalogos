// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Materializes the Host ownership schema and role prerequisites through the
 * Bootstrap-authorized path, keeping schema policy out of persistence.
 * @module ownership-schema
 */

import {
  createProblemError,
  parseBootId,
  parseHostOwnershipToken,
  type ProblemError,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import {
  HOST_LEASE_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_FENCE_TABLE,
  HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_OWNERSHIP_SCHEMA,
  HOST_RUNTIME_ROLE,
  HOST_DURABLE_EXECUTION_ROLE,
} from "./contracts.js";
import {
  type BootstrapAdminClient,
  type BootstrapAdminPasswordProvider,
  withBootstrapAdminClient,
} from "./bootstrap-admin.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
import { queryWithAuthority as authorizedMutation } from "./authorized-query.js";

/** Supplies authority and connection inputs for ownership schema setup. */
export interface OwnershipSchemaOptions {
  readonly port: number;
  readonly instanceId: InstanceId;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Reports which ownership schema components were created or initialized. */
export interface OwnershipSchemaResult {
  readonly schemaCreated: boolean;
  readonly tableCreated: boolean;
  readonly fenceRowInitialized: boolean;
}

interface SchemaRow {
  readonly schema_name: string;
  readonly owner_name: string;
}

interface TableRow {
  readonly table_name: string;
  readonly owner_name: string;
  readonly relkind: string;
}

interface ColumnRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly not_null: boolean;
}

interface ConstraintRow {
  readonly conname: string;
  readonly contype: string;
  readonly definition: string;
}

interface FunctionRow {
  readonly owner_name: string;
  readonly security_definer: boolean;
  readonly language_name: string;
  readonly result_definition: string;
  readonly source: string;
  readonly config: readonly string[] | null;
}

interface AclRow {
  readonly grantor: string;
  readonly grantee: string;
  readonly privilege_type: string;
  readonly is_grantable: boolean;
  readonly owner_name?: string;
}

interface ColumnAclRow extends AclRow {
  readonly column_name: string;
}

interface FenceRow {
  readonly singleton: boolean;
  readonly instance_id: string;
  readonly ownership_revision: string | number;
  readonly host_ownership_token: string | null;
  readonly boot_id: string | null;
}

const SCHEMA_QUERY = `
SELECT n.nspname AS schema_name, pg_get_userbyid(n.nspowner) AS owner_name
FROM pg_catalog.pg_namespace AS n
WHERE n.nspname = $1
`;

const DATABASE_ACL_QUERY = `
SELECT pg_get_userbyid(databases.datdba) AS owner_name,
       pg_get_userbyid(acl.grantor) AS grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_database AS databases
CROSS JOIN LATERAL aclexplode(
  COALESCE(databases.datacl, acldefault('d', databases.datdba))
) AS acl
WHERE databases.datname = $1
`;

const SCHEMA_ACL_QUERY = `
SELECT pg_get_userbyid(namespaces.nspowner) AS owner_name,
       pg_get_userbyid(acl.grantor) AS grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_namespace AS namespaces
CROSS JOIN LATERAL aclexplode(
  COALESCE(namespaces.nspacl, acldefault('n', namespaces.nspowner))
) AS acl
WHERE namespaces.nspname = $1
`;

const TABLE_QUERY = `
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner_name,
       c.relkind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
`;

const COLUMN_QUERY = `
SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum
`;

const COLUMN_ACL_QUERY = `
SELECT a.attname AS column_name,
       pg_get_userbyid(acl.grantor) AS grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
  a.attacl
) AS acl
WHERE n.nspname = $1 AND c.relname = $2
  AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
ORDER BY a.attnum, acl.grantee, acl.privilege_type
`;

const CONSTRAINT_QUERY = `
SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = $1::regclass
ORDER BY conname
`;

const TABLE_ACL_QUERY = `
SELECT pg_get_userbyid(tables.relowner) AS owner_name,
       pg_get_userbyid(acl.grantor) AS grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_class AS tables
JOIN pg_catalog.pg_namespace AS namespaces ON namespaces.oid = tables.relnamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(tables.relacl, acldefault('r', tables.relowner))
) AS acl
WHERE namespaces.nspname = $1 AND tables.relname = $2
`;

const FUNCTION_QUERY = `
SELECT pg_get_userbyid(functions.proowner) AS owner_name,
       functions.prosecdef AS security_definer,
       languages.lanname AS language_name,
       pg_get_function_result(functions.oid) AS result_definition,
       functions.prosrc AS source,
       functions.proconfig AS config
FROM pg_catalog.pg_proc AS functions
JOIN pg_catalog.pg_namespace AS namespaces
  ON namespaces.oid = functions.pronamespace
JOIN pg_catalog.pg_language AS languages
  ON languages.oid = functions.prolang
WHERE namespaces.nspname = $1 AND functions.proname = $2
`;

const FUNCTION_ACL_QUERY = `
SELECT pg_get_userbyid(functions.proowner) AS owner_name,
       pg_get_userbyid(acl.grantor) AS grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_catalog.pg_proc AS functions
JOIN pg_catalog.pg_namespace AS namespaces
  ON namespaces.oid = functions.pronamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(functions.proacl, acldefault('f', functions.proowner))
) AS acl
WHERE namespaces.nspname = $1
  AND functions.proname = $2
  AND functions.pronargs = 0
`;

const FENCE_QUERY = `
SELECT singleton, instance_id, ownership_revision, host_ownership_token, boot_id
FROM "heptalogos"."host_ownership_fence"
ORDER BY singleton
`;

function schemaProblem(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "host-ownership",
    retryClass: "manual",
    title,
    detail,
  });
}

function incompatibleSchemaProblem(detail: string): ProblemError {
  return schemaProblem(
    "host-ownership.schema.incompatible",
    "Host ownership schema is incompatible",
    detail,
  );
}

function instanceMismatchProblem(): ProblemError {
  return schemaProblem(
    "host-ownership.schema.instance_mismatch",
    "Host ownership fence belongs to another instance",
    "The canonical HostOwnershipFence singleton row has a different InstanceId",
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function explicitAcl(rows: readonly AclRow[]): readonly AclRow[] {
  // PostgreSQL reports the object's implicit owner privileges through
  // acldefault(). They are authority inherent to the canonical owner, not
  // grant edges that Host ownership must manage. Every other explicit edge
  // remains visible and is validated closed-world.
  return rows.filter(
    (row) => row.owner_name === undefined || row.grantee !== row.owner_name,
  );
}

function aclKeys(rows: readonly AclRow[]): Set<string> {
  return new Set(
    rows.map(
      (row) => `${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`,
    ),
  );
}

function assertAclSubset(
  rows: readonly AclRow[],
  allowed: ReadonlySet<string>,
  detail: string,
): void {
  for (const edge of aclKeys(explicitAcl(rows))) {
    if (!allowed.has(edge)) throw incompatibleSchemaProblem(detail);
  }
}

function assertAclExact(
  rows: readonly AclRow[],
  expected: ReadonlySet<string>,
  detail: string,
): void {
  const actual = aclKeys(explicitAcl(rows));
  if (
    actual.size !== expected.size ||
    [...actual].some((edge) => !expected.has(edge))
  ) {
    throw incompatibleSchemaProblem(detail);
  }
}

function assertExactColumns(rows: readonly ColumnRow[]): void {
  const expected = [
    ["singleton", "boolean", true],
    ["instance_id", "uuid", true],
    ["ownership_revision", "bigint", true],
    ["host_ownership_token", "uuid", false],
    ["boot_id", "uuid", false],
  ] as const;
  if (
    rows.length !== expected.length ||
    rows.some(
      (row, index) =>
        row.column_name !== expected[index][0] ||
        row.data_type !== expected[index][1] ||
        row.not_null !== expected[index][2],
    )
  ) {
    throw incompatibleSchemaProblem(
      "HostOwnershipFence columns do not match the canonical schema",
    );
  }
}

function assertNoColumnAcl(rows: readonly ColumnAclRow[]): void {
  if (rows.length !== 0) {
    throw incompatibleSchemaProblem(
      "HostOwnershipFence has explicit column privileges outside the closed-world contract",
    );
  }
}

function normalizeDefinition(definition: string): string {
  return definition.replace(/\s+/gu, " ").trim().toLowerCase();
}

const FENCE_LOCK_FUNCTION_SOURCE = `
SELECT f.singleton,
       f.instance_id,
       f.ownership_revision,
       f.host_ownership_token,
       f.boot_id
FROM "heptalogos"."host_ownership_fence" AS f
WHERE f.singleton = true
FOR SHARE
`.trim();

const FENCE_LOCK_FUNCTION_RESULT =
  "TABLE(singleton boolean, instance_id uuid, ownership_revision bigint, host_ownership_token uuid, boot_id uuid)";

function fenceLockFunctionRef(): string {
  return `${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)}.${quoteIdentifier(HOST_OWNERSHIP_FENCE_LOCK_FUNCTION)}()`;
}

function assertFenceLockFunction(row: FunctionRow): void {
  if (
    row.owner_name !== HOST_OWNERSHIP_OWNER_ROLE ||
    row.security_definer !== true ||
    row.language_name !== "sql" ||
    normalizeDefinition(row.result_definition) !==
      normalizeDefinition(FENCE_LOCK_FUNCTION_RESULT) ||
    normalizeDefinition(row.source) !==
      normalizeDefinition(FENCE_LOCK_FUNCTION_SOURCE) ||
    row.config === null ||
    row.config.length !== 1 ||
    row.config[0] !== "search_path=pg_catalog"
  ) {
    throw incompatibleSchemaProblem(
      "HostOwnershipFence lock function does not match the canonical security-definer contract",
    );
  }
}

function assertExactConstraints(rows: readonly ConstraintRow[]): void {
  const actual = new Set(
    rows.map((row) => `${row.contype}:${normalizeDefinition(row.definition)}`),
  );
  const expected = new Set([
    "p:primary key (singleton)",
    "c:check (singleton)",
    "c:check (ownership_revision >= 0)",
  ]);
  if (
    rows.length !== expected.size ||
    [...expected].some((constraint) => !actual.has(constraint))
  ) {
    throw incompatibleSchemaProblem(
      "HostOwnershipFence constraints do not match the canonical schema",
    );
  }
}

function assertFenceRow(row: FenceRow, instanceId: InstanceId): void {
  const revision = String(row.ownership_revision);
  if (
    row.singleton !== true ||
    row.instance_id !== instanceId ||
    !/^\d+$/u.test(revision) ||
    (row.host_ownership_token !== null &&
      parseHostOwnershipToken(row.host_ownership_token) === undefined) ||
    (row.boot_id !== null && parseBootId(row.boot_id) === undefined)
  ) {
    throw incompatibleSchemaProblem(
      "HostOwnershipFence singleton row does not match the canonical shape",
    );
  }
}

async function ensureDatabasePrivileges(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<void> {
  const rows = await client.query<AclRow>(DATABASE_ACL_QUERY, [
    HOST_OWNERSHIP_CANONICAL_DATABASE,
  ]);
  assertAclSubset(
    rows.rows,
    new Set([
      "PUBLIC:CONNECT:false",
      "PUBLIC:TEMPORARY:false",
      `${HOST_LEASE_ROLE}:CONNECT:false`,
      `${HOST_MIGRATION_ROLE}:CONNECT:false`,
      `${HOST_RUNTIME_ROLE}:CONNECT:false`,
      `${HOST_DURABLE_EXECUTION_ROLE}:CONNECT:false`,
    ]),
    "Unexpected explicit database privilege exists on the canonical database",
  );
  await authorizedMutation(
    client,
    authority,
    `REVOKE ALL ON DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} FROM PUBLIC`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} TO ${quoteIdentifier(HOST_LEASE_ROLE)}`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} TO ${quoteIdentifier(HOST_RUNTIME_ROLE)}`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} TO ${quoteIdentifier(HOST_MIGRATION_ROLE)}`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} TO ${quoteIdentifier(HOST_DURABLE_EXECUTION_ROLE)}`,
  );
  const verified = await client.query<AclRow>(DATABASE_ACL_QUERY, [
    HOST_OWNERSHIP_CANONICAL_DATABASE,
  ]);
  assertAclExact(
    verified.rows,
    new Set([
      `${HOST_LEASE_ROLE}:CONNECT:false`,
      `${HOST_RUNTIME_ROLE}:CONNECT:false`,
      `${HOST_MIGRATION_ROLE}:CONNECT:false`,
      `${HOST_DURABLE_EXECUTION_ROLE}:CONNECT:false`,
    ]),
    "Canonical database privileges do not match the closed-world contract",
  );
}

async function ensurePublicSchemaPrivileges(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<void> {
  const rows = await client.query<AclRow>(SCHEMA_ACL_QUERY, ["public"]);
  assertAclSubset(
    rows.rows,
    new Set(["PUBLIC:USAGE:false", "PUBLIC:CREATE:false"]),
    "Unexpected explicit privilege exists on the public schema",
  );
  const preserved = new Set(
    [...aclKeys(explicitAcl(rows.rows))].filter(
      (edge) => edge !== "PUBLIC:CREATE:false",
    ),
  );
  await authorizedMutation(
    client,
    authority,
    "REVOKE CREATE ON SCHEMA public FROM PUBLIC",
  );
  const verified = await client.query<AclRow>(SCHEMA_ACL_QUERY, ["public"]);
  assertAclExact(
    verified.rows,
    preserved,
    "Public schema privileges do not match the closed-world contract",
  );
}

async function ensureProductSchema(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<boolean> {
  const rows = await client.query<SchemaRow>(SCHEMA_QUERY, [HOST_OWNERSHIP_SCHEMA]);
  if (rows.rows.length > 1) {
    throw incompatibleSchemaProblem(
      "Multiple canonical Heptalogos schemas were observed",
    );
  }
  const existing = rows.rows[0];
  const schemaCreated = existing === undefined;
  if (existing !== undefined && existing.owner_name !== HOST_OWNERSHIP_OWNER_ROLE) {
    throw incompatibleSchemaProblem(
      "The Heptalogos schema owner is not heptalogos_owner",
    );
  }

  if (schemaCreated) {
    await authorizedMutation(
      client,
      authority,
      `CREATE SCHEMA ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)} AUTHORIZATION ${quoteIdentifier(HOST_OWNERSHIP_OWNER_ROLE)}`,
    );
  } else {
    const acl = await client.query<AclRow>(SCHEMA_ACL_QUERY, [HOST_OWNERSHIP_SCHEMA]);
    assertAclSubset(
      acl.rows,
      new Set([
        "PUBLIC:USAGE:false",
        "PUBLIC:CREATE:false",
        `${HOST_LEASE_ROLE}:USAGE:false`,
        `${HOST_RUNTIME_ROLE}:USAGE:false`,
      ]),
      "Unexpected explicit privilege exists on the Heptalogos schema",
    );
  }
  await authorizedMutation(
    client,
    authority,
    `REVOKE ALL ON SCHEMA ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)} FROM PUBLIC`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT USAGE ON SCHEMA ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)} TO ${quoteIdentifier(HOST_LEASE_ROLE)}`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT USAGE ON SCHEMA ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)} TO ${quoteIdentifier(HOST_RUNTIME_ROLE)}`,
  );
  const verified = await client.query<AclRow>(SCHEMA_ACL_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
  ]);
  assertAclExact(
    verified.rows,
    new Set([`${HOST_LEASE_ROLE}:USAGE:false`, `${HOST_RUNTIME_ROLE}:USAGE:false`]),
    "Heptalogos schema privileges do not match the closed-world contract",
  );
  return schemaCreated;
}

async function ensureFenceTable(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<boolean> {
  const rows = await client.query<TableRow>(TABLE_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
    HOST_OWNERSHIP_FENCE_TABLE,
  ]);
  if (rows.rows.length > 1) {
    throw incompatibleSchemaProblem("Multiple HostOwnershipFence tables were observed");
  }
  const existing = rows.rows[0];
  const tableCreated = existing === undefined;
  const tableRef = `${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)}.${quoteIdentifier(HOST_OWNERSHIP_FENCE_TABLE)}`;
  if (existing !== undefined) {
    if (
      existing.owner_name !== HOST_OWNERSHIP_OWNER_ROLE ||
      existing.relkind !== "r" ||
      existing.table_name !== HOST_OWNERSHIP_FENCE_TABLE
    ) {
      throw incompatibleSchemaProblem(
        "HostOwnershipFence table ownership or kind is incompatible",
      );
    }
    const columns = await client.query<ColumnRow>(COLUMN_QUERY, [
      HOST_OWNERSHIP_SCHEMA,
      HOST_OWNERSHIP_FENCE_TABLE,
    ]);
    assertExactColumns(columns.rows);
    const columnAcl = await client.query<ColumnAclRow>(COLUMN_ACL_QUERY, [
      HOST_OWNERSHIP_SCHEMA,
      HOST_OWNERSHIP_FENCE_TABLE,
    ]);
    assertNoColumnAcl(columnAcl.rows);
    const constraints = await client.query<ConstraintRow>(CONSTRAINT_QUERY, [
      `${HOST_OWNERSHIP_SCHEMA}.${HOST_OWNERSHIP_FENCE_TABLE}`,
    ]);
    assertExactConstraints(constraints.rows.filter((row) => row.contype !== "n"));
    const acl = await client.query<AclRow>(TABLE_ACL_QUERY, [
      HOST_OWNERSHIP_SCHEMA,
      HOST_OWNERSHIP_FENCE_TABLE,
    ]);
    assertAclSubset(
      acl.rows,
      new Set([
        "PUBLIC:SELECT:false",
        "PUBLIC:INSERT:false",
        "PUBLIC:UPDATE:false",
        "PUBLIC:DELETE:false",
        "PUBLIC:TRUNCATE:false",
        "PUBLIC:REFERENCES:false",
        "PUBLIC:TRIGGER:false",
        `${HOST_LEASE_ROLE}:SELECT:false`,
        `${HOST_LEASE_ROLE}:UPDATE:false`,
        `${HOST_RUNTIME_ROLE}:SELECT:false`,
      ]),
      "Unexpected explicit privilege exists on HostOwnershipFence",
    );
  } else {
    await authorizedMutation(
      client,
      authority,
      `
CREATE TABLE ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)}.${quoteIdentifier(HOST_OWNERSHIP_FENCE_TABLE)} (
  singleton boolean NOT NULL,
  instance_id uuid NOT NULL,
  ownership_revision bigint NOT NULL,
  host_ownership_token uuid NULL,
  boot_id uuid NULL,
  CONSTRAINT host_ownership_fence_singleton_pkey PRIMARY KEY (singleton),
  CONSTRAINT host_ownership_fence_singleton_check CHECK (singleton),
  CONSTRAINT host_ownership_fence_revision_check CHECK (ownership_revision >= 0)
)`,
    );
    await authorizedMutation(
      client,
      authority,
      `ALTER TABLE ${tableRef} OWNER TO ${quoteIdentifier(HOST_OWNERSHIP_OWNER_ROLE)}`,
    );
  }
  await authorizedMutation(
    client,
    authority,
    `REVOKE ALL ON TABLE ${tableRef} FROM PUBLIC`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT SELECT, UPDATE ON TABLE ${tableRef} TO ${quoteIdentifier(HOST_LEASE_ROLE)}`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT SELECT ON TABLE ${tableRef} TO ${quoteIdentifier(HOST_RUNTIME_ROLE)}`,
  );
  const verified = await client.query<AclRow>(TABLE_ACL_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
    HOST_OWNERSHIP_FENCE_TABLE,
  ]);
  assertAclExact(
    verified.rows,
    new Set([
      `${HOST_LEASE_ROLE}:SELECT:false`,
      `${HOST_LEASE_ROLE}:UPDATE:false`,
      `${HOST_RUNTIME_ROLE}:SELECT:false`,
    ]),
    "HostOwnershipFence privileges do not match the closed-world contract",
  );
  return tableCreated;
}

async function ensureFenceLockFunction(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<void> {
  const metadata = await client.query<FunctionRow>(FUNCTION_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
    HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  ]);
  if (metadata.rows.length > 1) {
    throw incompatibleSchemaProblem(
      "Multiple HostOwnershipFence lock function overloads were observed",
    );
  }

  const functionRef = fenceLockFunctionRef();
  if (metadata.rows.length === 0) {
    await authorizedMutation(
      client,
      authority,
      `
CREATE FUNCTION ${functionRef}
RETURNS TABLE (
  singleton boolean,
  instance_id uuid,
  ownership_revision bigint,
  host_ownership_token uuid,
  boot_id uuid
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = pg_catalog
AS $host_ownership$
${FENCE_LOCK_FUNCTION_SOURCE}
$host_ownership$`,
    );
    await authorizedMutation(
      client,
      authority,
      `ALTER FUNCTION ${functionRef} OWNER TO ${quoteIdentifier(HOST_OWNERSHIP_OWNER_ROLE)}`,
    );
  } else {
    assertFenceLockFunction(metadata.rows[0]);
  }

  const beforeAcl = await client.query<AclRow>(FUNCTION_ACL_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
    HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  ]);
  assertAclSubset(
    beforeAcl.rows,
    new Set(["PUBLIC:EXECUTE:false", `${HOST_RUNTIME_ROLE}:EXECUTE:false`]),
    "Unexpected explicit privilege exists on the HostOwnershipFence lock function",
  );
  await authorizedMutation(
    client,
    authority,
    `REVOKE ALL ON FUNCTION ${functionRef} FROM PUBLIC`,
  );
  await authorizedMutation(
    client,
    authority,
    `GRANT EXECUTE ON FUNCTION ${functionRef} TO ${quoteIdentifier(HOST_RUNTIME_ROLE)}`,
  );
  const verifiedAcl = await client.query<AclRow>(FUNCTION_ACL_QUERY, [
    HOST_OWNERSHIP_SCHEMA,
    HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  ]);
  assertAclExact(
    verifiedAcl.rows,
    new Set([`${HOST_RUNTIME_ROLE}:EXECUTE:false`]),
    "HostOwnershipFence lock function privileges do not match the closed-world contract",
  );
}

async function ensureFenceRow(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
  instanceId: InstanceId,
): Promise<boolean> {
  const rows = await client.query<FenceRow>(FENCE_QUERY);
  if (rows.rows.length > 1) {
    throw incompatibleSchemaProblem(
      "Multiple HostOwnershipFence singleton rows were observed",
    );
  }
  const existing = rows.rows[0];
  if (existing !== undefined) {
    if (existing.instance_id !== instanceId) throw instanceMismatchProblem();
    assertFenceRow(existing, instanceId);
    return false;
  }
  await authorizedMutation(
    client,
    authority,
    `
INSERT INTO ${quoteIdentifier(HOST_OWNERSHIP_SCHEMA)}.${quoteIdentifier(HOST_OWNERSHIP_FENCE_TABLE)}
  (singleton, instance_id, ownership_revision, host_ownership_token, boot_id)
VALUES (true, $1, 0, NULL, NULL)
`,
    [instanceId],
  );
  return true;
}

/** Ensures the canonical Host ownership schema and initial fence row exist. */
export async function ensureHostOwnershipSchema(
  options: OwnershipSchemaOptions,
): Promise<OwnershipSchemaResult> {
  return withBootstrapAdminClient(
    {
      port: options.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      passwordProvider: options.passwordProvider,
    },
    async (client) => {
      await ensureDatabasePrivileges(client, options.mutationAuthority);
      await ensurePublicSchemaPrivileges(client, options.mutationAuthority);
      const schemaCreated = await ensureProductSchema(
        client,
        options.mutationAuthority,
      );
      const tableCreated = await ensureFenceTable(client, options.mutationAuthority);
      await ensureFenceLockFunction(client, options.mutationAuthority);
      const fenceRowInitialized = await ensureFenceRow(
        client,
        options.mutationAuthority,
        options.instanceId,
      );
      return { schemaCreated, tableCreated, fenceRowInitialized };
    },
  );
}
