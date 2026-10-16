// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns formal native identity linkage behind Host fencing. @module service */
import { createUuidV7Id, createProblemError } from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  executeRepositorySql as sql,
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import {
  resolveAccountInputSchema,
  resolveGroupInputSchema,
  subjectEntityInputSchema,
  bindSubjectAccountInputSchema,
  linkAccountInputSchema,
  type HostEntity,
  type IdentityService,
  type IdentityServiceOptions,
  type ResolveAccountInput,
} from "./contracts.js";
const validators = {
  account: compileSchema(resolveAccountInputSchema),
  group: compileSchema(resolveGroupInputSchema),
  subject: compileSchema(subjectEntityInputSchema),
  bind: compileSchema(bindSubjectAccountInputSchema),
  link: compileSchema(linkAccountInputSchema),
};
function check(
  validator: { validate(value: unknown): { ok: boolean } },
  input: unknown,
) {
  if (!validator.validate(input).ok)
    throw createProblemError({
      problemCode: "identity.invalid_input",
      title: "Identity input is invalid",
      detail: "Native identifiers must be nonempty lossless strings",
      category: "validation",
      retryClass: "manual",
    });
}
function conflict(): never {
  throw createProblemError({
    problemCode: "identity.link_conflict",
    title: "Identity keys already have different owners",
    detail:
      "Explicitly reconcile existing Entity references before linking these authenticated identifiers",
    category: "conflict",
    retryClass: "manual",
  });
}
function lineage(c: PersistenceMutationTransactionContext) {
  return JSON.stringify({
    schemaVersion: 1,
    sourceActivityId: c.execution.activityId,
    sourceInstanceId: c.execution.instanceId,
    sourceContinuityEpochId: c.execution.continuityEpochId,
  });
}
/** Creates a Host entity owner. All mutations run inside the caller's real Host Activity. */
export function createIdentityService(
  options: IdentityServiceOptions,
): IdentityService {
  const mutate = <T>(
    f: (
      tx: PersistenceInternalTransaction,
      c: PersistenceMutationTransactionContext,
    ) => Promise<T>,
  ) =>
    options.persistence.mutate((c) =>
      useRepositoryMutationTransaction(c, (tx) => f(tx, c)),
    );
  const entity = async (tx: PersistenceInternalTransaction, ref: string) => {
    const [r] = await sql<{ entity_ref: string; kind: HostEntity["kind"] }>(
      tx,
      "SELECT entity_ref,kind FROM heptalogos.identity_entity WHERE entity_ref=$1",
      [ref],
    );
    return r ? { entityRef: r.entity_ref, kind: r.kind } : undefined;
  };
  const create = async (
    tx: PersistenceInternalTransaction,
    c: PersistenceMutationTransactionContext,
    kind: HostEntity["kind"],
  ) => {
    const entityRef = createUuidV7Id("HostEntityRef");
    await sql(
      tx,
      "INSERT INTO heptalogos.identity_entity(entity_ref,kind,lineage_context_ref) VALUES($1,$2,$3::jsonb)",
      [entityRef, kind, lineage(c)],
    );
    return { entityRef, kind };
  };
  // Identity linkage is rare and bounded. One database transaction lock avoids races when an account/UID pair intersects another pair.
  const lock = (tx: PersistenceInternalTransaction) =>
    sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended('heptalogos.identity',0))");
  const resolve = async (
    tx: PersistenceInternalTransaction,
    c: PersistenceMutationTransactionContext,
    input: ResolveAccountInput,
    target?: HostEntity,
  ) => {
    const keys: [string, string][] = [
      ["account", input.accountId],
      ...(input.uid ? [["uid", input.uid] as [string, string]] : []),
    ];
    const refs = new Set<string>();
    for (const [kind, native] of keys) {
      const [r] = await sql<{ entity_ref: string }>(
        tx,
        "SELECT entity_ref FROM heptalogos.identity_external_key WHERE platform=$1 AND kind=$2 AND native_id=$3",
        [input.platform, kind, native],
      );
      if (r) refs.add(r.entity_ref);
    }
    if (refs.size > 1 || (target && [...refs].some((ref) => ref !== target.entityRef)))
      conflict();
    const current =
      target ??
      (refs.size ? await entity(tx, [...refs][0]!) : await create(tx, c, "person"));
    if (!current || current.kind === "group") conflict();
    for (const [kind, native] of keys)
      await sql(
        tx,
        "INSERT INTO heptalogos.identity_external_key(platform,kind,native_id,entity_ref) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [input.platform, kind, native, current.entityRef],
      );
    return current;
  };
  const subject = async (
    tx: PersistenceInternalTransaction,
    c: PersistenceMutationTransactionContext,
    subjectId: string,
  ) => {
    const [r] = await sql<{ entity_ref: string }>(
      tx,
      "SELECT entity_ref FROM heptalogos.identity_subject WHERE subject_id=$1",
      [subjectId],
    );
    if (r) return (await entity(tx, r.entity_ref))!;
    const next = await create(tx, c, "subject");
    await sql(
      tx,
      "INSERT INTO heptalogos.identity_subject(subject_id,entity_ref) VALUES($1,$2)",
      [subjectId, next.entityRef],
    );
    return next;
  };
  return {
    async resolveAccount(input) {
      check(validators.account, input);
      return mutate(async (tx, c) => {
        await lock(tx);
        return resolve(tx, c, input);
      });
    },
    async resolveGroup(input) {
      check(validators.group, input);
      return mutate(async (tx, c) => {
        await lock(tx);
        const [r] = await sql<{ entity_ref: string }>(
          tx,
          "SELECT entity_ref FROM heptalogos.identity_external_key WHERE platform=$1 AND kind='group' AND native_id=$2",
          [input.platform, input.groupId],
        );
        if (r) return (await entity(tx, r.entity_ref))!;
        const next = await create(tx, c, "group");
        await sql(
          tx,
          "INSERT INTO heptalogos.identity_external_key(platform,kind,native_id,entity_ref) VALUES($1,'group',$2,$3)",
          [input.platform, input.groupId, next.entityRef],
        );
        return next;
      });
    },
    async ensureSubjectEntity(input) {
      check(validators.subject, input);
      return mutate(async (tx, c) => {
        await lock(tx);
        return subject(tx, c, input.subjectId);
      });
    },
    async readSubjectEntity(input) {
      check(validators.subject, input);
      return options.persistence.read((c) =>
        useRepositoryReadTransaction(c, async (tx) => {
          const [r] = await sql<{ entity_ref: string }>(
            tx,
            "SELECT entity_ref FROM heptalogos.identity_subject WHERE subject_id=$1",
            [input.subjectId],
          );
          return { entity: r ? ((await entity(tx, r.entity_ref)) ?? null) : null };
        }),
      );
    },
    async bindSubjectAccount(input) {
      check(validators.bind, input);
      return mutate(async (tx, c) => {
        await lock(tx);
        const own = await subject(tx, c, input.subjectId);
        return resolve(tx, c, input, own);
      });
    },
    async linkAccount(input) {
      check(validators.link, input);
      return mutate(async (tx, c) => {
        await lock(tx);
        const target = await entity(tx, input.entityRef);
        if (!target) conflict();
        return resolve(tx, c, input, target);
      });
    },
  };
}
