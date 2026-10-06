// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Manages the short-lived PostgreSQL bootstrap-admin connection used to create
 * ownership roles and schema before the Host lease exists.
 * @module bootstrap-admin
 */

import { randomBytes } from "node:crypto";
import { Client } from "pg";
import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import {
  HOST_LEASE_ROLE,
  HOST_LEASE_SCRAM_ITERATIONS,
  HOST_LEASE_SCRAM_SALT_BYTES,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_RUNTIME_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_DURABLE_EXECUTION_ROLE,
} from "./contracts.js";
import type { HostAdvisoryKey } from "./advisory-key.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
import {
  encodePostgresScramSha256Verifier,
  matchesPostgresScramSha256Verifier,
} from "./scram-verifier.js";
import { asPostgresBoolean } from "./postgres-values.js";

interface BootstrapAdminQueryResult<Row> {
  readonly rows: readonly Row[];
}

/** Minimal privileged query surface used during Bootstrap provisioning. */
export interface BootstrapAdminClient {
  /** Executes one parameterized administrative query. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<BootstrapAdminQueryResult<Row>>;
  /** Closes the short-lived Bootstrap-admin session. */
  end(): Promise<void>;
}

interface BootstrapAdminConnectionOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/** Creates a short-lived Bootstrap-admin client for a loopback database. */
interface BootstrapAdminClientFactory {
  /** Connects with the supplied Bootstrap-admin credentials. */
  connect(options: BootstrapAdminConnectionOptions): Promise<BootstrapAdminClient>;
}

/** Supplies each PostgreSQL role password only within a callback scope. */
export interface BootstrapAdminPasswordProvider {
  /** Uses the Bootstrap-admin password without returning it. */
  withBootstrapPassword<T>(use: (passwordUtf8: Uint8Array) => Promise<T>): Promise<T>;
  /** Uses the Host-lease password without returning it. */
  withHostLeasePassword<T>(use: (passwordUtf8: Uint8Array) => Promise<T>): Promise<T>;
  /** Uses the runtime password without returning it. */
  withRuntimePassword<T>(use: (passwordUtf8: Uint8Array) => Promise<T>): Promise<T>;
  /** Uses the migration password without returning it. */
  withMigrationPassword<T>(use: (passwordUtf8: Uint8Array) => Promise<T>): Promise<T>;
  /** Uses the durable-engine password without returning it. */
  withDurableExecutionPassword<T>(
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
}

/** Supplies authority and optional client seams for role/database provisioning. */
export interface BootstrapAdminProvisioningOptions {
  readonly port: number;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Reports the role and database resources created by provisioning. */
export interface BootstrapAdminProvisioningResult {
  readonly ownerRoleCreated: boolean;
  readonly hostLeaseRoleCreated: boolean;
  readonly runtimeRoleCreated: boolean;
  readonly migrationRoleCreated: boolean;
  readonly durableExecutionRoleCreated: boolean;
  readonly databaseCreated: boolean;
}

/** Supplies credentials and endpoint details for one admin session. */
export interface BootstrapAdminSessionOptions {
  readonly port: number;
  readonly database: string;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
}

/** Supplies the advisory key and authority for a temporary Host reservation. */
export interface BootstrapHostReservationOptions {
  readonly port: number;
  readonly advisoryKey: HostAdvisoryKey;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Supplies credentials and authority for read-only database inspection. */
export interface BootstrapAdminInspectionOptions {
  readonly port: number;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Reports whether the canonical Host database exists and its identity. */
export interface CanonicalHostDatabaseInspection {
  readonly exists: boolean;
  readonly database?: {
    readonly datname: string;
    readonly owner_name: string;
    readonly encoding_name: string;
  };
}

/** Supplies the advisory key and endpoint for lease inspection. */
export interface HostAdvisoryLeaseInspectionOptions {
  readonly port: number;
  readonly advisoryKey: HostAdvisoryKey;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
}

/** Reports live Host lease backends matching the canonical advisory key. */
export interface HostAdvisoryLeaseInspection {
  readonly live: boolean;
  readonly backendPids: readonly number[];
}

/** Captures the database roles, objects, ACLs, and fence row for qualification. */
export interface HostOwnershipCanonicalSnapshot {
  readonly roles: readonly {
    readonly rolname: string;
    readonly rolcanlogin: boolean;
    readonly rolsuper: boolean;
    readonly rolcreatedb: boolean;
    readonly rolcreaterole: boolean;
    readonly rolreplication: boolean;
    readonly rolbypassrls: boolean;
    readonly rolconnlimit: number;
    readonly rolinherit: boolean;
  }[];
  readonly database: readonly {
    readonly datname: string;
    readonly owner_name: string;
    readonly encoding_name: string;
    readonly acl: string | null;
  }[];
  readonly schema: readonly {
    readonly nspname: string;
    readonly owner_name: string;
    readonly acl: string | null;
  }[];
  readonly table: readonly {
    readonly relname: string;
    readonly owner_name: string;
    readonly acl: string | null;
  }[];
  readonly fence: readonly {
    readonly instance_id: string;
    readonly ownership_revision: string | number;
    readonly host_ownership_token: string | null;
    readonly boot_id: string | null;
  }[];
}

/** Supplies credentials and a client seam for canonical snapshot inspection. */
export interface HostOwnershipCanonicalSnapshotOptions {
  readonly port: number;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
}

/** Represents a temporary Bootstrap Host advisory reservation. */
export interface BootstrapHostReservation {
  /** Releases the reservation and closes its administrative connection. */
  release(): Promise<void>;
}

interface RoleRow {
  readonly rolname: string;
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
  readonly rolconnlimit: number;
  readonly rolinherit: boolean;
  readonly rolpassword: string | null;
}

interface MembershipRow {
  readonly member_role: string;
  readonly granted_role: string;
  readonly admin_option: unknown;
  readonly inherit_option: unknown;
  readonly set_option: unknown;
}

interface ExpectedMembership {
  readonly memberRole: string;
  readonly grantedRole: string;
  readonly adminOption: boolean;
  readonly inheritOption: boolean;
  readonly setOption: boolean;
}

const EXPECTED_PROTECTED_MEMBERSHIPS: readonly ExpectedMembership[] = [
  {
    memberRole: HOST_MIGRATION_ROLE,
    grantedRole: HOST_OWNERSHIP_OWNER_ROLE,
    adminOption: false,
    inheritOption: false,
    setOption: true,
  },
];

interface DatabaseRow {
  readonly datname: string;
  readonly owner_name: string;
  readonly encoding_name: string;
}

const ROLE_QUERY = `
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolconnlimit, rolinherit, rolpassword
FROM pg_catalog.pg_authid
WHERE rolname = $1
`;

const MEMBERSHIP_QUERY = `
SELECT member.rolname AS member_role,
       granted_role.rolname AS granted_role,
       memberships.admin_option,
       memberships.inherit_option,
       memberships.set_option
FROM pg_catalog.pg_auth_members AS memberships
JOIN pg_catalog.pg_roles AS member ON member.oid = memberships.member
JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = memberships.roleid
 WHERE member.rolname IN ($1, $2, $3, $4, $5)
   OR granted_role.rolname IN ($1, $2, $3, $4, $5)
`;

const DATABASE_QUERY = `
SELECT datname, pg_get_userbyid(datdba) AS owner_name,
       pg_encoding_to_char(encoding) AS encoding_name
FROM pg_catalog.pg_database
WHERE datname = $1
`;

function provisioningProblem(
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

function incompatibleRoleProblem(roleName: string): ProblemError {
  return provisioningProblem(
    "host-ownership.bootstrap_admin.incompatible_role",
    "Host ownership role is incompatible",
    `Existing PostgreSQL role ${roleName} does not satisfy the fixed least-privilege contract`,
  );
}

function incompatibleDatabaseProblem(): ProblemError {
  return provisioningProblem(
    "host-ownership.bootstrap_admin.incompatible_database",
    "Host ownership database is incompatible",
    `Existing PostgreSQL database ${HOST_OWNERSHIP_CANONICAL_DATABASE} does not satisfy the fixed ownership contract`,
  );
}

function credentialMismatchProblem(roleName: string): ProblemError {
  return provisioningProblem(
    "host-ownership.bootstrap_admin.credential_mismatch",
    "Host ownership credential does not match",
    `Existing PostgreSQL role ${roleName} has a different credential; automatic password reset is forbidden`,
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw provisioningProblem(
      "host-ownership.bootstrap_admin.invalid_bootstrap_credential",
      "Bootstrap credential is invalid UTF-8",
      "The bootstrap PostgreSQL credential could not be decoded as UTF-8",
    );
  }
}

async function authorizedMutation<Row = never>(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
  text: string,
  values?: readonly unknown[],
): Promise<BootstrapAdminQueryResult<Row>> {
  authority.assertCurrent();
  const result = await client.query<Row>(text, values);
  authority.assertCurrent();
  return result;
}

function roleIsExact(
  role: RoleRow,
  expectedLogin: boolean,
  expectedConnectionLimit: number,
  expectedInherit: boolean,
): boolean {
  return (
    role.rolcanlogin === expectedLogin &&
    role.rolsuper === false &&
    role.rolcreatedb === false &&
    role.rolcreaterole === false &&
    role.rolreplication === false &&
    role.rolbypassrls === false &&
    role.rolconnlimit === expectedConnectionLimit &&
    role.rolinherit === expectedInherit
  );
}

function membershipsAreExact(
  actual: readonly MembershipRow[],
  expected: readonly ExpectedMembership[],
): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((required) =>
    actual.some(
      (membership) =>
        membership.member_role === required.memberRole &&
        membership.granted_role === required.grantedRole &&
        asPostgresBoolean(membership.admin_option) === required.adminOption &&
        asPostgresBoolean(membership.inherit_option) === required.inheritOption &&
        asPostgresBoolean(membership.set_option) === required.setOption,
    ),
  );
}

async function ensureRole(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
  roleName: string,
  expectedLogin: boolean,
  expectedConnectionLimit: number,
  verifier: string | undefined,
  passwordUtf8: Uint8Array | undefined,
  expectedMemberships: readonly ExpectedMembership[] = [],
  expectedInherit = false,
): Promise<boolean> {
  const roles = await client.query<RoleRow>(ROLE_QUERY, [roleName]);
  if (roles.rows.length > 1) throw incompatibleRoleProblem(roleName);
  const existing = roles.rows[0];
  if (existing !== undefined) {
    const memberships = await client.query<MembershipRow>(MEMBERSHIP_QUERY, [
      HOST_OWNERSHIP_OWNER_ROLE,
      HOST_LEASE_ROLE,
      HOST_RUNTIME_ROLE,
      HOST_MIGRATION_ROLE,
      HOST_DURABLE_EXECUTION_ROLE,
    ]);
    if (
      !roleIsExact(existing, expectedLogin, expectedConnectionLimit, expectedInherit) ||
      !(expectedMemberships.length === 0
        ? memberships.rows.length === 0 ||
          membershipsAreExact(memberships.rows, EXPECTED_PROTECTED_MEMBERSHIPS)
        : membershipsAreExact(memberships.rows, expectedMemberships))
    ) {
      throw incompatibleRoleProblem(roleName);
    }
    if (
      expectedLogin &&
      (passwordUtf8 === undefined ||
        !matchesPostgresScramSha256Verifier(passwordUtf8, existing.rolpassword))
    ) {
      throw credentialMismatchProblem(roleName);
    }
    return false;
  }

  const privilegeClauses = [
    expectedLogin ? "LOGIN" : "NOLOGIN",
    "NOSUPERUSER",
    "NOCREATEDB",
    "NOCREATEROLE",
    "NOREPLICATION",
    "NOBYPASSRLS",
    expectedInherit ? "INHERIT" : "NOINHERIT",
  ];
  const connectionClause = ` CONNECTION LIMIT ${expectedConnectionLimit}`;
  const passwordClause =
    verifier === undefined ? "" : ` PASSWORD ${quoteLiteral(verifier)}`;
  await authorizedMutation(
    client,
    authority,
    `CREATE ROLE ${quoteIdentifier(roleName)} ${privilegeClauses.join(" ")}${connectionClause}${passwordClause}`,
  );
  for (const membership of expectedMemberships.filter(
    (candidate) => candidate.memberRole === roleName,
  )) {
    await authorizedMutation(
      client,
      authority,
      `GRANT ${quoteIdentifier(membership.grantedRole)} TO ${quoteIdentifier(membership.memberRole)} WITH INHERIT ${membership.inheritOption ? "TRUE" : "FALSE"}, SET ${membership.setOption ? "TRUE" : "FALSE"}`,
    );
  }
  return true;
}

async function ensureDatabase(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<boolean> {
  const databases = await client.query<DatabaseRow>(DATABASE_QUERY, [
    HOST_OWNERSHIP_CANONICAL_DATABASE,
  ]);
  if (databases.rows.length > 1) throw incompatibleDatabaseProblem();
  const existing = databases.rows[0];
  if (existing !== undefined) {
    if (
      existing.owner_name !== HOST_OWNERSHIP_OWNER_ROLE ||
      existing.encoding_name !== "UTF8" ||
      existing.datname !== HOST_OWNERSHIP_CANONICAL_DATABASE
    ) {
      throw incompatibleDatabaseProblem();
    }
    return false;
  }

  await authorizedMutation(
    client,
    authority,
    `CREATE DATABASE ${quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE)} OWNER ${quoteIdentifier(HOST_OWNERSHIP_OWNER_ROLE)} ENCODING 'UTF8' TEMPLATE template0`,
  );
  return true;
}

async function ensureDatabaseConnectAcl(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
): Promise<void> {
  const database = quoteIdentifier(HOST_OWNERSHIP_CANONICAL_DATABASE);
  await authorizedMutation(
    client,
    authority,
    `REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`,
  );
  for (const role of [
    HOST_LEASE_ROLE,
    HOST_RUNTIME_ROLE,
    HOST_MIGRATION_ROLE,
    HOST_DURABLE_EXECUTION_ROLE,
  ]) {
    await authorizedMutation(
      client,
      authority,
      `GRANT CONNECT ON DATABASE ${database} TO ${quoteIdentifier(role)}`,
    );
  }
}

const defaultClientFactory: BootstrapAdminClientFactory = {
  async connect(options) {
    const client = new Client(options);
    await client.connect();
    return {
      async query<Row>(text: string, values: readonly unknown[] = []) {
        const result = await client.query(text, [...values]);
        return { rows: result.rows as Row[] };
      },
      end: () => client.end(),
    };
  },
};

/** Runs one callback under a short-lived Bootstrap-admin client. */
export async function withBootstrapAdminClient<T>(
  options: BootstrapAdminSessionOptions,
  use: (client: BootstrapAdminClient) => Promise<T>,
): Promise<T> {
  const factory = defaultClientFactory;
  return options.passwordProvider.withBootstrapPassword(async (passwordUtf8) => {
    const admin = await factory.connect({
      host: "127.0.0.1",
      port: options.port,
      database: options.database,
      user: "heptalogos_bootstrap",
      password: decodeUtf8(passwordUtf8),
    });
    try {
      return await use(admin);
    } finally {
      await admin.end();
    }
  });
}

/** Attempts to reserve the Host advisory key for Bootstrap setup. */
export async function acquireBootstrapHostReservation(
  options: BootstrapHostReservationOptions,
): Promise<BootstrapHostReservation | undefined> {
  const factory = defaultClientFactory;
  return options.passwordProvider.withBootstrapPassword(async (passwordUtf8) => {
    const client = await factory.connect({
      host: "127.0.0.1",
      port: options.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: "heptalogos_bootstrap",
      password: decodeUtf8(passwordUtf8),
    });
    try {
      const result = await authorizedMutation<{ readonly acquired: unknown }>(
        client,
        options.mutationAuthority,
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
        [options.advisoryKey.key1, options.advisoryKey.key2],
      );
      const acquired = asPostgresBoolean(result.rows[0]?.acquired);
      if (acquired === undefined) {
        throw provisioningProblem(
          "host-ownership.reservation.invalid_result",
          "Bootstrap Host reservation result is invalid",
          "PostgreSQL did not return a boolean advisory reservation result",
        );
      }
      if (!acquired) {
        await client.end();
        return undefined;
      }

      let releasePromise: Promise<void> | undefined;
      return {
        release() {
          if (releasePromise !== undefined) return releasePromise;
          releasePromise = (async () => {
            try {
              const releasedResult = await authorizedMutation<{
                readonly released: unknown;
              }>(
                client,
                options.mutationAuthority,
                "SELECT pg_advisory_unlock($1::integer, $2::integer) AS released",
                [options.advisoryKey.key1, options.advisoryKey.key2],
              );
              if (asPostgresBoolean(releasedResult.rows[0]?.released) !== true) {
                throw provisioningProblem(
                  "host-ownership.reservation.release_failed",
                  "Bootstrap Host reservation release failed",
                  "PostgreSQL did not confirm release of the bootstrap advisory reservation",
                );
              }
            } finally {
              await client.end();
            }
          })();
          return releasePromise;
        },
      };
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
  });
}

/** Inspects the canonical Host database from the Bootstrap-admin connection. */
export async function inspectCanonicalHostDatabase(
  options: BootstrapAdminInspectionOptions,
): Promise<CanonicalHostDatabaseInspection> {
  return withBootstrapAdminClient(
    {
      port: options.port,
      database: "postgres",
      passwordProvider: options.passwordProvider,
    },
    async (admin) => {
      options.mutationAuthority.assertCurrent();
      const databases = await admin.query<DatabaseRow>(DATABASE_QUERY, [
        HOST_OWNERSHIP_CANONICAL_DATABASE,
      ]);
      options.mutationAuthority.assertCurrent();
      if (databases.rows.length > 1) throw incompatibleDatabaseProblem();
      const database = databases.rows[0];
      return database === undefined ? { exists: false } : { exists: true, database };
    },
  );
}

function advisoryKeyMatches(
  classId: string | null,
  objectId: string | null,
  key: HostAdvisoryKey,
): boolean {
  if (classId === null || objectId === null) return false;
  const asUnsigned = (value: number): number => value >>> 0;
  const classValue = Number(classId);
  const objectValue = Number(objectId);
  return (
    (classValue === key.key1 && objectValue === key.key2) ||
    (classValue === asUnsigned(key.key1) && objectValue === asUnsigned(key.key2))
  );
}

/** Inspects whether the dedicated Host lease advisory lock is live. */
export async function inspectHostAdvisoryLease(
  options: HostAdvisoryLeaseInspectionOptions,
): Promise<HostAdvisoryLeaseInspection> {
  return withBootstrapAdminClient(
    {
      port: options.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      passwordProvider: options.passwordProvider,
    },
    async (client) => {
      const result = await client.query<{
        readonly pid: number;
        readonly classid: string | null;
        readonly objid: string | null;
      }>(
        `
SELECT activity.pid, locks.classid::text, locks.objid::text
FROM pg_locks AS locks
JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
WHERE locks.locktype = 'advisory'
  AND activity.usename = $1
  AND activity.datname = $2
`,
        [HOST_LEASE_ROLE, HOST_OWNERSHIP_CANONICAL_DATABASE],
      );
      const backendPids = result.rows
        .filter((row) =>
          advisoryKeyMatches(row.classid, row.objid, options.advisoryKey),
        )
        .map((row) => row.pid);
      return { live: backendPids.length > 0, backendPids };
    },
  );
}

/** Reads the canonical roles, schema, fence, and ACL projection for qualification. */
export async function inspectHostOwnershipCanonicalSnapshot(
  options: HostOwnershipCanonicalSnapshotOptions,
): Promise<HostOwnershipCanonicalSnapshot> {
  const administrative = await withBootstrapAdminClient(
    {
      port: options.port,
      database: "postgres",
      passwordProvider: options.passwordProvider,
    },
    async (admin) => {
      const roles = await admin.query<HostOwnershipCanonicalSnapshot["roles"][number]>(
        `
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolconnlimit, rolinherit
FROM pg_catalog.pg_roles
WHERE rolname IN ($1, $2, $3, $4, $5)
ORDER BY rolname
`,
        [
          HOST_OWNERSHIP_OWNER_ROLE,
          HOST_LEASE_ROLE,
          HOST_RUNTIME_ROLE,
          HOST_MIGRATION_ROLE,
          HOST_DURABLE_EXECUTION_ROLE,
        ],
      );
      const database = await admin.query<
        HostOwnershipCanonicalSnapshot["database"][number]
      >(
        `
SELECT datname, pg_get_userbyid(datdba) AS owner_name,
       pg_encoding_to_char(encoding) AS encoding_name,
       datacl::text AS acl
FROM pg_catalog.pg_database
WHERE datname = $1
`,
        [HOST_OWNERSHIP_CANONICAL_DATABASE],
      );
      return { roles: roles.rows, database: database.rows };
    },
  );
  const ownership = await withBootstrapAdminClient(
    {
      port: options.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      passwordProvider: options.passwordProvider,
    },
    async (admin) => {
      const schema = await admin.query<
        HostOwnershipCanonicalSnapshot["schema"][number]
      >(
        `
SELECT nspname, pg_get_userbyid(nspowner) AS owner_name,
       nspacl::text AS acl
FROM pg_catalog.pg_namespace
WHERE nspname = $1
`,
        ["heptalogos"],
      );
      const table = await admin.query<HostOwnershipCanonicalSnapshot["table"][number]>(
        `
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner_name,
       c.relacl::text AS acl
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
`,
        ["heptalogos", "host_ownership_fence"],
      );
      const fence = await admin.query<HostOwnershipCanonicalSnapshot["fence"][number]>(
        `
SELECT instance_id, ownership_revision, host_ownership_token, boot_id
FROM "heptalogos"."host_ownership_fence"
WHERE singleton = true
`,
      );
      return { schema: schema.rows, table: table.rows, fence: fence.rows };
    },
  );
  return {
    ...administrative,
    ...ownership,
  };
}

/** Provisions the canonical Host roles, database, and ownership prerequisites. */
export async function provisionHostOwnershipDatabase(
  options: BootstrapAdminProvisioningOptions,
): Promise<BootstrapAdminProvisioningResult> {
  return withBootstrapAdminClient(
    {
      port: options.port,
      database: "postgres",
      passwordProvider: options.passwordProvider,
    },
    async (admin) => {
      const ownerRoleCreated = await ensureRole(
        admin,
        options.mutationAuthority,
        HOST_OWNERSHIP_OWNER_ROLE,
        false,
        -1,
        undefined,
        undefined,
      );
      return options.passwordProvider.withHostLeasePassword(
        async (hostLeasePasswordUtf8) => {
          const verifier = encodePostgresScramSha256Verifier(hostLeasePasswordUtf8, {
            iterations: HOST_LEASE_SCRAM_ITERATIONS,
            salt: randomBytes(HOST_LEASE_SCRAM_SALT_BYTES),
          });
          const hostLeaseRoleCreated = await ensureRole(
            admin,
            options.mutationAuthority,
            HOST_LEASE_ROLE,
            true,
            1,
            verifier,
            hostLeasePasswordUtf8,
          );
          return options.passwordProvider.withRuntimePassword(
            async (runtimePasswordUtf8) => {
              const runtimeVerifier = encodePostgresScramSha256Verifier(
                runtimePasswordUtf8,
                {
                  iterations: HOST_LEASE_SCRAM_ITERATIONS,
                  salt: randomBytes(HOST_LEASE_SCRAM_SALT_BYTES),
                },
              );
              const runtimeRoleCreated = await ensureRole(
                admin,
                options.mutationAuthority,
                HOST_RUNTIME_ROLE,
                true,
                -1,
                runtimeVerifier,
                runtimePasswordUtf8,
              );
              return options.passwordProvider.withMigrationPassword(
                async (migrationPasswordUtf8) => {
                  const migrationVerifier = encodePostgresScramSha256Verifier(
                    migrationPasswordUtf8,
                    {
                      iterations: HOST_LEASE_SCRAM_ITERATIONS,
                      salt: randomBytes(HOST_LEASE_SCRAM_SALT_BYTES),
                    },
                  );
                  const migrationRoleCreated = await ensureRole(
                    admin,
                    options.mutationAuthority,
                    HOST_MIGRATION_ROLE,
                    true,
                    1,
                    migrationVerifier,
                    migrationPasswordUtf8,
                    EXPECTED_PROTECTED_MEMBERSHIPS,
                  );
                  return options.passwordProvider.withDurableExecutionPassword(
                    async (durableExecutionPasswordUtf8) => {
                      const durableExecutionVerifier =
                        encodePostgresScramSha256Verifier(
                          durableExecutionPasswordUtf8,
                          {
                            iterations: HOST_LEASE_SCRAM_ITERATIONS,
                            salt: randomBytes(HOST_LEASE_SCRAM_SALT_BYTES),
                          },
                        );
                      const durableExecutionRoleCreated = await ensureRole(
                        admin,
                        options.mutationAuthority,
                        HOST_DURABLE_EXECUTION_ROLE,
                        true,
                        -1,
                        durableExecutionVerifier,
                        durableExecutionPasswordUtf8,
                        [],
                        true,
                      );
                      const databaseCreated = await ensureDatabase(
                        admin,
                        options.mutationAuthority,
                      );
                      await ensureDatabaseConnectAcl(admin, options.mutationAuthority);
                      return {
                        ownerRoleCreated,
                        hostLeaseRoleCreated,
                        runtimeRoleCreated,
                        migrationRoleCreated,
                        durableExecutionRoleCreated,
                        databaseCreated,
                      };
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
}
