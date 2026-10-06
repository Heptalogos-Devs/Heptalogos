// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provisions and verifies the DBOS vendor schema through the installed CLI
 * while preserving the Host migration Authority and product-schema boundary.
 * @module schema-provisioner
 */

import { Client } from "pg";
import {
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_OWNER_ROLE,
  type HostCanonicalMigrationAuthority,
} from "@heptalogos/host-ownership";
import {
  type DurableExecutionPackageResolution,
  type DurableExecutionProcessOptions,
  type DurableExecutionProcessResult,
  type DurableExecutionSchemaProvisioner,
  type DurableExecutionSchemaProvisionerOptions,
} from "../contracts.js";
import { resolveDbosPackage } from "./package.js";
import { dbosProcessDiagnostic, runDbosCli } from "./process.js";
import { durableExecutionProblem } from "../problems.js";

interface DurableExecutionSchemaClient {
  connect(): Promise<unknown>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
  end(): Promise<void>;
}

interface DurableExecutionSchemaClientOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: typeof HOST_OWNERSHIP_CANONICAL_DATABASE;
  readonly user: typeof HOST_MIGRATION_ROLE;
  readonly password: string;
  readonly connectionTimeoutMillis: number;
  readonly statementTimeout: number;
}

interface DurableExecutionSchemaClientFactory {
  create(options: DurableExecutionSchemaClientOptions): DurableExecutionSchemaClient;
}

type DbosPackageResolver = () => DurableExecutionPackageResolution;
type DbosCliRunner = (
  options: DurableExecutionProcessOptions,
) => Promise<DurableExecutionProcessResult>;

interface ProvisionerDependencies {
  readonly resolvePackage: DbosPackageResolver;
  readonly runCli: DbosCliRunner;
  readonly clientFactory: DurableExecutionSchemaClientFactory;
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DBOS_SCHEMA = "dbos" as const;
const PRODUCT_SCHEMA = "heptalogos" as const;

const SESSION_AND_SCHEMA_QUERY = `
SELECT current_user,
       session_user,
       (
         SELECT pg_get_userbyid(nspowner)
         FROM pg_catalog.pg_namespace
         WHERE nspname = $2
       ) AS dbos_owner,
       has_schema_privilege($1, $2, 'USAGE') AS durable_schema_usage,
       has_schema_privilege($1, $2, 'CREATE') AS durable_schema_create,
       has_schema_privilege($1, $3, 'USAGE') AS durable_product_schema_usage,
       has_schema_privilege($1, $3, 'CREATE') AS durable_product_schema_create
`;

const REQUIRED_RELATIONS_QUERY = `
SELECT to_regclass('"dbos"."workflow_status"') AS dbos_workflow_status
`;

const PRODUCT_RELATION_PRIVILEGE_QUERY = `
SELECT c.relname AS relation_name,
       c.relkind,
       CASE WHEN c.relkind = 'S'
            THEN has_sequence_privilege($1, c.oid, 'SELECT')
            ELSE has_table_privilege($1, c.oid, 'SELECT')
       END AS can_read,
       CASE WHEN c.relkind = 'S'
            THEN false
            ELSE has_table_privilege($1, c.oid, 'INSERT')
       END AS can_insert,
       CASE WHEN c.relkind = 'S'
            THEN has_sequence_privilege($1, c.oid, 'UPDATE')
            ELSE has_table_privilege($1, c.oid, 'UPDATE')
       END AS can_update,
       CASE WHEN c.relkind = 'S'
            THEN false
            ELSE has_table_privilege($1, c.oid, 'DELETE')
       END AS can_delete,
       CASE WHEN c.relkind = 'S'
            THEN has_sequence_privilege($1, c.oid, 'USAGE')
            ELSE false
       END AS can_usage
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
 WHERE n.nspname = $2
   AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
 ORDER BY c.relkind, c.relname
`;

const PRODUCT_ROUTINE_PRIVILEGE_QUERY = `
SELECT p.oid::regprocedure::text AS routine_name,
       p.prokind,
       has_function_privilege($1, p.oid, 'EXECUTE') AS can_execute
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
 WHERE n.nspname = $2
   AND p.prokind IN ('f', 'p')
 ORDER BY routine_name
`;

const DBOS_PRIVILEGE_QUERY = `
SELECT
  has_table_privilege($1, '"dbos"."workflow_status"', 'SELECT') AS dbos_select,
  has_table_privilege($1, '"dbos"."workflow_status"', 'INSERT') AS dbos_insert,
  has_table_privilege($1, '"dbos"."workflow_status"', 'UPDATE') AS dbos_update,
  has_table_privilege($1, '"dbos"."workflow_status"', 'DELETE') AS dbos_delete
`;

const REQUIRED_PRODUCT_RELATIONS = [
  "instance_continuity",
  "activity_record",
  "activity_link",
  "evidence_record",
  "work_item",
] as const;

interface SessionAndSchemaRow {
  readonly current_user: unknown;
  readonly session_user: unknown;
  readonly dbos_owner: unknown;
  readonly durable_schema_usage: unknown;
  readonly durable_schema_create: unknown;
  readonly durable_product_schema_usage: unknown;
  readonly durable_product_schema_create: unknown;
}

interface RequiredRelationsRow {
  readonly dbos_workflow_status: unknown;
}

interface ProductRelationPrivilegeRow {
  readonly relation_name: unknown;
  readonly relkind: unknown;
  readonly can_read: unknown;
  readonly can_insert: unknown;
  readonly can_update: unknown;
  readonly can_delete: unknown;
  readonly can_usage: unknown;
}

interface ProductRoutinePrivilegeRow {
  readonly routine_name: unknown;
  readonly prokind: unknown;
  readonly can_execute: unknown;
}

interface DbosPrivilegeRow {
  readonly dbos_select: unknown;
  readonly dbos_insert: unknown;
  readonly dbos_update: unknown;
  readonly dbos_delete: unknown;
}

const defaultClientFactory: DurableExecutionSchemaClientFactory = {
  create(options) {
    const client = new Client({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      connectionTimeoutMillis: options.connectionTimeoutMillis,
      statement_timeout: options.statementTimeout,
      application_name: "heptalogos-durable-schema-verification",
      options: `-c role=${HOST_OWNERSHIP_OWNER_ROLE}`,
    });
    return client;
  },
};

function assertProvisionerOptions(
  options: DurableExecutionSchemaProvisionerOptions,
): void {
  if (
    !Number.isSafeInteger(options.processTimeoutMs) ||
    options.processTimeoutMs <= 0 ||
    !Number.isSafeInteger(options.connectionTimeoutMs) ||
    options.connectionTimeoutMs <= 0 ||
    !Number.isSafeInteger(options.statementTimeoutMs) ||
    options.statementTimeoutMs <= 0
  ) {
    throw durableExecutionProblem(
      "durable.execution.schema.invalid_options",
      "DBOS schema provisioning requires positive safe-integer timeout bounds",
    );
  }
}

function provisioningUrl(authority: HostCanonicalMigrationAuthority): string {
  return `postgresql://${HOST_MIGRATION_ROLE}@${authority.target.host}:${authority.target.port}/${HOST_OWNERSHIP_CANONICAL_DATABASE}`;
}

function processFailureDetail(result: DurableExecutionProcessResult): string {
  const diagnostic = dbosProcessDiagnostic(result);
  return diagnostic.length === 0
    ? `The DBOS schema CLI exited with code ${String(result.exitCode)}`
    : `The DBOS schema CLI exited with code ${String(result.exitCode)}: ${diagnostic}`;
}

async function withMigrationClient<T>(
  authority: HostCanonicalMigrationAuthority,
  options: DurableExecutionSchemaProvisionerOptions,
  clientFactory: DurableExecutionSchemaClientFactory,
  use: (client: DurableExecutionSchemaClient) => Promise<T>,
): Promise<T> {
  authority.assertCurrent();
  return authority.withMigrationDatabasePassword(async (passwordUtf8) => {
    authority.assertCurrent();
    const password = UTF8_DECODER.decode(passwordUtf8);
    const client = clientFactory.create({
      host: authority.target.host,
      port: authority.target.port,
      database: authority.target.database,
      user: HOST_MIGRATION_ROLE,
      password,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      statementTimeout: options.statementTimeoutMs,
    });
    try {
      await client.connect();
      authority.assertCurrent();
      const result = await use(client);
      authority.assertCurrent();
      return result;
    } finally {
      await client.end();
    }
  });
}

async function queryWithAuthority<Row>(
  authority: HostCanonicalMigrationAuthority,
  client: DurableExecutionSchemaClient,
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly Row[]> {
  authority.assertCurrent();
  const result = await client.query<Row>(text, values);
  authority.assertCurrent();
  return result.rows;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function isPresent(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

async function verifyProvisionedSchema(
  authority: HostCanonicalMigrationAuthority,
  options: DurableExecutionSchemaProvisionerOptions,
  clientFactory: DurableExecutionSchemaClientFactory,
): Promise<void> {
  await withMigrationClient(authority, options, clientFactory, async (client) => {
    const sessionRows = await queryWithAuthority<SessionAndSchemaRow>(
      authority,
      client,
      SESSION_AND_SCHEMA_QUERY,
      [HOST_DURABLE_EXECUTION_ROLE, DBOS_SCHEMA, PRODUCT_SCHEMA],
    );
    const session = sessionRows[0];
    if (
      sessionRows.length !== 1 ||
      session === undefined ||
      session.current_user !== HOST_OWNERSHIP_OWNER_ROLE ||
      session.session_user !== HOST_MIGRATION_ROLE ||
      session.dbos_owner !== HOST_OWNERSHIP_OWNER_ROLE ||
      !isTrue(session.durable_schema_usage) ||
      isTrue(session.durable_schema_create) ||
      isTrue(session.durable_product_schema_usage) ||
      isTrue(session.durable_product_schema_create)
    ) {
      throw durableExecutionProblem(
        "durable.execution.schema.verification_failed",
        "DBOS schema ownership or migration-session privilege boundaries are not current",
      );
    }

    const relationRows = await queryWithAuthority<RequiredRelationsRow>(
      authority,
      client,
      REQUIRED_RELATIONS_QUERY,
    );
    const relations = relationRows[0];
    if (
      relationRows.length !== 1 ||
      relations === undefined ||
      !isPresent(relations.dbos_workflow_status)
    ) {
      throw durableExecutionProblem(
        "durable.execution.schema.verification_failed",
        "The DBOS workflow-status relation is missing",
      );
    }

    const productRelationRows = await queryWithAuthority<ProductRelationPrivilegeRow>(
      authority,
      client,
      PRODUCT_RELATION_PRIVILEGE_QUERY,
      [HOST_DURABLE_EXECUTION_ROLE, PRODUCT_SCHEMA],
    );
    const observedProductRelations = new Set(
      productRelationRows.map((row) => row.relation_name),
    );
    if (
      REQUIRED_PRODUCT_RELATIONS.some(
        (relationName) => !observedProductRelations.has(relationName),
      ) ||
      productRelationRows.some(
        (row) =>
          !isPresent(row.relation_name) ||
          !isPresent(row.relkind) ||
          isTrue(row.can_read) ||
          isTrue(row.can_insert) ||
          isTrue(row.can_update) ||
          isTrue(row.can_delete) ||
          isTrue(row.can_usage),
      )
    ) {
      throw durableExecutionProblem(
        "durable.execution.schema.verification_failed",
        "The durable role has access to a current product relation or a required product relation is missing",
      );
    }

    const productRoutineRows = await queryWithAuthority<ProductRoutinePrivilegeRow>(
      authority,
      client,
      PRODUCT_ROUTINE_PRIVILEGE_QUERY,
      [HOST_DURABLE_EXECUTION_ROLE, PRODUCT_SCHEMA],
    );
    if (productRoutineRows.some((row) => isTrue(row.can_execute))) {
      throw durableExecutionProblem(
        "durable.execution.schema.verification_failed",
        "The durable role can execute a current product-schema function or procedure",
      );
    }

    const privilegeRows = await queryWithAuthority<DbosPrivilegeRow>(
      authority,
      client,
      DBOS_PRIVILEGE_QUERY,
      [HOST_DURABLE_EXECUTION_ROLE],
    );
    const privileges = privilegeRows[0];
    if (
      privilegeRows.length !== 1 ||
      privileges === undefined ||
      ![
        privileges.dbos_select,
        privileges.dbos_insert,
        privileges.dbos_update,
        privileges.dbos_delete,
      ].every(isTrue)
    ) {
      throw durableExecutionProblem(
        "durable.execution.schema.verification_failed",
        "The durable role does not have the exact DBOS workflow-status runtime rights",
      );
    }
  });
}

async function ensureCurrentWithDependencies(
  authority: HostCanonicalMigrationAuthority,
  options: DurableExecutionSchemaProvisionerOptions,
  dependencies: ProvisionerDependencies,
): Promise<void> {
  authority.assertCurrent();
  const packageResolution = dependencies.resolvePackage();
  authority.assertCurrent();
  const processResult = await authority.withMigrationDatabasePassword(
    async (passwordUtf8) => {
      authority.assertCurrent();
      const result = await dependencies.runCli({
        cliPath: packageResolution.cliPath,
        args: [
          "schema",
          provisioningUrl(authority),
          "--schema",
          DBOS_SCHEMA,
          "--app-role",
          HOST_DURABLE_EXECUTION_ROLE,
        ],
        timeoutMs: options.processTimeoutMs,
        env: {
          PGPASSWORD: UTF8_DECODER.decode(passwordUtf8),
          PGOPTIONS: `-c role=${HOST_OWNERSHIP_OWNER_ROLE}`,
        },
      });
      authority.assertCurrent();
      return result;
    },
  );
  if (processResult.exitCode !== 0) {
    throw durableExecutionProblem(
      "durable.execution.schema.provision_failed",
      processFailureDetail(processResult),
    );
  }
  authority.assertCurrent();
  await verifyProvisionedSchema(authority, options, dependencies.clientFactory);
  authority.assertCurrent();
}

/** Creates the DBOS vendor-schema provisioner with explicit operational bounds. */
export function createDurableExecutionSchemaProvisioner(
  options: DurableExecutionSchemaProvisionerOptions,
): DurableExecutionSchemaProvisioner {
  assertProvisionerOptions(options);
  return Object.freeze({
    ensureCurrent(authority: HostCanonicalMigrationAuthority): Promise<void> {
      return ensureCurrentWithDependencies(authority, options, {
        resolvePackage: resolveDbosPackage,
        runCli: runDbosCli,
        clientFactory: defaultClientFactory,
      });
    },
  });
}

/** Test-only constructor that keeps process and PostgreSQL effects injectable. */
export function createDurableExecutionSchemaProvisionerForTests(
  options: DurableExecutionSchemaProvisionerOptions,
  dependencies: ProvisionerDependencies,
): DurableExecutionSchemaProvisioner {
  assertProvisionerOptions(options);
  return Object.freeze({
    ensureCurrent(authority: HostCanonicalMigrationAuthority): Promise<void> {
      return ensureCurrentWithDependencies(authority, options, dependencies);
    },
  });
}
