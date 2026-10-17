// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Revocable logical foreground qualification across short Host transactions.
 * @module reactor
 */
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createSubjectSchemaReader } from "./checked-schema.js";
import {
  readRepositorySql,
  executeRepositorySql as sql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { ActivityOpportunity } from "./contracts.js";
import { lockSubjectNarrative } from "./world-life.js";
import { subjectProblem } from "./problems.js";
import {
  reactorLimitsSchema,
  subjectReactionSchema,
  reactorActionReceiptSchema,
  type SubjectReactorOptions,
  type SubjectReaction,
  type ForegroundQualification,
  type InteractionAction,
  type ReactorActionReceipt,
  type ReactorLimits,
} from "./reactor-contracts.js";
function denied(detail: string): never {
  throw subjectProblem(
    "reactor.foreground_changed",
    "Subject foreground cannot proceed",
    detail,
  );
}
const checked = createSubjectSchemaReader(() => {
  throw subjectProblem(
    "reactor.invalid_input",
    "Invalid Reactor state",
    "Use the current owner contract",
    "validation",
  );
});
/** Owns qualifications and receipts; Attention ranks sources and native owners retain actual results. */
export function createSubjectReactorService(options: SubjectReactorOptions) {
  const readReaction = async (
    subjectId: string,
    reactionId: string,
    tx?: PersistenceInternalTransaction,
  ): Promise<SubjectReaction | undefined> => {
    const statement =
      "SELECT document FROM heptalogos.subject_reaction WHERE subject_id=$1 AND reaction_id=$2";
    const rows = tx
      ? await sql<{ document: unknown }>(tx, statement, [subjectId, reactionId])
      : await readRepositorySql<{ document: unknown }>(options.persistence, statement, [
          subjectId,
          reactionId,
        ]);
    return rows[0]
      ? checked<SubjectReaction>(subjectReactionSchema, rows[0].document)
      : undefined;
  };
  const current = async (
    subjectId: string,
    tx?: PersistenceInternalTransaction,
  ): Promise<SubjectReaction | undefined> => {
    const statement =
      "SELECT r.document FROM heptalogos.subject_foreground f JOIN heptalogos.subject_reaction r ON r.reaction_id=f.reaction_id AND r.subject_id=f.subject_id WHERE f.subject_id=$1";
    const rows = tx
      ? await sql<{ document: unknown }>(tx, statement, [subjectId])
      : await readRepositorySql<{ document: unknown }>(options.persistence, statement, [
          subjectId,
        ]);
    return rows[0]
      ? checked<SubjectReaction>(subjectReactionSchema, rows[0].document)
      : undefined;
  };
  const save = async (
    tx: PersistenceInternalTransaction,
    reaction: SubjectReaction,
  ) => {
    const value = checked<SubjectReaction>(subjectReactionSchema, reaction);
    await sql(
      tx,
      "UPDATE heptalogos.subject_reaction SET document=$3::jsonb,updated_at=$4 WHERE subject_id=$1 AND reaction_id=$2",
      [value.subjectId, value.reactionId, JSON.stringify(value), options.now()],
    );
    return value;
  };
  const assertCurrentIn = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    activityId: string,
    focus: ForegroundQualification,
    budget = true,
  ) => {
    await lockSubjectNarrative(tx, subjectId);
    const actual = await current(subjectId, tx);
    if (
      !actual ||
      actual.state !== "active" ||
      actual.activityId !== activityId ||
      actual.reactionId !== focus.reactionId ||
      actual.focusRevision !== focus.focusRevision
    )
      denied(
        "This role/result no longer owns the Subject foreground; retain it without adoption",
      );
    if (budget && Date.parse(options.now()) >= Date.parse(actual.deadlineAt))
      denied(
        "This Reaction exhausted its real-time budget; retain its continuation before yielding",
      );
    await options.assertActivityIn(tx, subjectId, activityId);
    return actual;
  };
  const mutate = <T>(fn: (tx: PersistenceInternalTransaction) => Promise<T>) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, fn),
    );
  const mutateRun = <T>(
    input: {
      subjectId: string;
      activityId: string;
      focus: ForegroundQualification;
      runId: string;
    },
    budget: boolean,
    update: (
      tx: PersistenceInternalTransaction,
      reaction: SubjectReaction,
    ) => Promise<T>,
  ) =>
    mutate(async (tx) =>
      update(
        tx,
        await assertCurrentIn(
          tx,
          input.subjectId,
          input.activityId,
          input.focus,
          budget,
        ),
      ),
    );
  const readAction = async (
    subjectId: string,
    actionId: string,
    tx?: PersistenceInternalTransaction,
  ): Promise<ReactorActionReceipt | undefined> => {
    const statement =
      "SELECT a.document FROM heptalogos.subject_reactor_action a JOIN heptalogos.subject_reaction r USING(reaction_id) WHERE r.subject_id=$1 AND a.action_id=$2";
    const rows = tx
      ? await sql<{ document: unknown }>(tx, statement, [subjectId, actionId])
      : await readRepositorySql<{ document: unknown }>(options.persistence, statement, [
          subjectId,
          actionId,
        ]);
    return rows[0]
      ? checked<ReactorActionReceipt>(reactorActionReceiptSchema, rows[0].document)
      : undefined;
  };
  return {
    current,
    /** Actual creation-time keyset is stable when a later Reaction has a lexically smaller UUID. */
    async history(input: {
      subjectId: string;
      limit: number;
      afterReactionId?: string;
    }) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 128)
        denied("History requires a bounded page of 1..128 Reactions");
      const rows = await readRepositorySql<{ document: unknown; reaction_id: string }>(
        options.persistence,
        `SELECT r.document,r.reaction_id FROM heptalogos.subject_reaction r WHERE r.subject_id=$1 AND ($2::uuid IS NULL OR (r.created_at,r.reaction_id)<(SELECT cursor.created_at,cursor.reaction_id FROM heptalogos.subject_reaction cursor WHERE cursor.subject_id=$1 AND cursor.reaction_id=$2)) ORDER BY r.created_at DESC,r.reaction_id DESC LIMIT $3`,
        [input.subjectId, input.afterReactionId ?? null, input.limit + 1],
      );
      const selected = rows.slice(0, input.limit);
      return {
        reactions: selected.map((row) =>
          checked<SubjectReaction>(subjectReactionSchema, row.document),
        ),
        more: rows.length > input.limit,
        nextReactionId: rows.length > input.limit ? selected.at(-1)!.reaction_id : null,
      };
    },
    /** Exact reserved role identity, including a never-prepared read, stays attached to its retired Reaction. */
    async reactionForRun(
      subjectId: string,
      runId: string,
      tx?: PersistenceInternalTransaction,
    ): Promise<SubjectReaction | undefined> {
      const query =
        "SELECT document FROM heptalogos.subject_reaction WHERE subject_id=$1 AND document->>'currentRunId'=$2";
      const rows = tx
        ? await sql<{ document: unknown }>(tx, query, [subjectId, runId])
        : await readRepositorySql<{ document: unknown }>(options.persistence, query, [
            subjectId,
            runId,
          ]);
      if (rows.length > 1)
        denied("A reserved foreground run cannot belong to multiple Reactions");
      return rows[0]
        ? checked<SubjectReaction>(subjectReactionSchema, rows[0].document)
        : undefined;
    },
    async lastAction(
      subjectId: string,
      reactionId: string,
    ): Promise<ReactorActionReceipt | undefined> {
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT a.document FROM heptalogos.subject_reactor_action a JOIN heptalogos.subject_reaction r USING(reaction_id) WHERE r.subject_id=$1 AND r.reaction_id=$2 ORDER BY (a.document->>'step')::integer DESC LIMIT 1",
        [subjectId, reactionId],
      );
      return rows[0]
        ? checked<ReactorActionReceipt>(reactorActionReceiptSchema, rows[0].document)
        : undefined;
    },
    readReaction,
    readAction,
    assertCurrentIn,
    /** Actual configured values are exposed to Host/Management, not separately defaulted. */
    async effectiveSettings(): Promise<ReactorLimits> {
      return checked<ReactorLimits>(
        reactorLimitsSchema,
        ((policy) => ({
          maxInteractionSteps: policy.maxInteractionSteps,
          reactionDeadlineMs: policy.reactionDeadlineMs,
          workerConcurrency: policy.workerConcurrency,
        }))(await options.policy()),
      );
    },
    /** Attention has already selected. This transaction changes qualification and fairness together. */
    async claim(input: {
      subjectId: string;
      activityId: string;
      reactionId: string;
      candidateRef: string;
      explanationRef: string;
      opportunity?: ActivityOpportunity;
      replace?: ForegroundQualification & { continuationRef: string };
    }): Promise<{ claimed: boolean; reaction: SubjectReaction }> {
      return mutate(async (tx) => {
        await lockSubjectNarrative(tx, input.subjectId);
        const settings = await options.policy(tx);
        const policy = checked<ReactorLimits>(reactorLimitsSchema, {
          maxInteractionSteps: settings.maxInteractionSteps,
          reactionDeadlineMs: settings.reactionDeadlineMs,
          workerConcurrency: settings.workerConcurrency,
        });
        const prior = await readReaction(input.subjectId, input.reactionId, tx);
        if (prior) {
          if (
            prior.activityId !== input.activityId ||
            prior.candidate.candidateRef !== input.candidateRef
          )
            denied("This Reaction identity already binds another actual opportunity");
          return { claimed: false, reaction: prior };
        }
        const selection = await options.attention.explain(
          input.subjectId,
          input.explanationRef,
          tx,
        );
        const candidate = [selection?.selected, selection?.switchRequested].find(
          (value) => value?.candidateRef === input.candidateRef,
        );
        if (
          !candidate ||
          candidate.subjectId !== input.subjectId ||
          (candidate.activityId && candidate.activityId !== input.activityId)
        )
          denied(
            "The chosen metadata source is not in the actual saved Attention selection",
          );
        const old = await current(input.subjectId, tx);
        if (old) {
          if (
            !input.replace ||
            old.reactionId !== input.replace.reactionId ||
            old.focusRevision !== input.replace.focusRevision ||
            old.currentRunId
          )
            denied(
              "The existing foreground must reach a safe node and save its continuation before switching",
            );
          if (
            (
              await sql(
                tx,
                "SELECT action_id FROM heptalogos.subject_reactor_action WHERE reaction_id=$1 AND document->>'state'='started'",
                [old.reactionId],
              )
            ).length
          )
            denied("The current foreground action has not reached a safe node");
          await save(tx, {
            ...old,
            state: "superseded",
            continuationRef: input.replace.continuationRef,
            stopReason: "attention_switch",
          });
        } else if (input.replace)
          denied("The supplied previous foreground no longer exists");
        await options.assertActivityIn(tx, input.subjectId, input.activityId);
        if (input.opportunity) {
          const actual = await options.life.get(input.subjectId, input.activityId, tx),
            due = input.opportunity;
          if (
            !actual ||
            actual.revision !== due.expectedRevision ||
            !actual.nextOpportunity ||
            actual.nextOpportunity.timeDomainRef !== due.scheduledAt.timeDomainRef ||
            actual.nextOpportunity.at !== due.scheduledAt.at ||
            due.world.timeDomainRef !== due.scheduledAt.timeDomainRef ||
            Date.parse(due.scheduledAt.at) > Date.parse(due.world.at)
          )
            denied("The actual due opportunity changed before foreground adoption");
          await options.life.progressIn(
            tx,
            {
              subjectId: input.subjectId,
              activityId: input.activityId,
              expectedRevision: actual.revision,
              progress: actual.progress,
              nextOpportunity: null,
              mode: "work",
            },
            due.world,
          );
        }
        const now = options.now();
        const rows = await sql<{ focus_revision: string | number }>(
          tx,
          "INSERT INTO heptalogos.subject_foreground(subject_id,focus_revision,reaction_id,updated_at) VALUES($1,1,$2,$3) ON CONFLICT(subject_id) DO UPDATE SET focus_revision=subject_foreground.focus_revision+1,reaction_id=excluded.reaction_id,updated_at=excluded.updated_at RETURNING focus_revision",
          [input.subjectId, input.reactionId, now],
        );
        const reaction = checked<SubjectReaction>(subjectReactionSchema, {
          subjectId: input.subjectId,
          activityId: input.activityId,
          reactionId: input.reactionId,
          focusRevision: Number(rows[0]!.focus_revision),
          candidate,
          explanationRef: input.explanationRef,
          startedAt: now,
          deadlineAt: new Date(
            Date.parse(now) + policy.reactionDeadlineMs,
          ).toISOString(),
          policy,
          state: "active",
          stepCount: 0,
        });
        await sql(
          tx,
          "INSERT INTO heptalogos.subject_reaction(reaction_id,subject_id,activity_id,document,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$5)",
          [
            reaction.reactionId,
            reaction.subjectId,
            reaction.activityId,
            JSON.stringify(reaction),
            now,
          ],
        );
        await options.attention.recordConsidered(
          {
            subjectId: input.subjectId,
            reactionId: input.reactionId,
            candidateRef: input.candidateRef,
            explanationRef: input.explanationRef,
          },
          tx,
        );
        return { claimed: true, reaction };
      });
    },
    /** Freezes one native foreground call before network I/O; no lock spans the call. */
    async bindRun(input: {
      subjectId: string;
      activityId: string;
      focus: ForegroundQualification;
      runId: string;
    }) {
      return mutateRun(input, true, async (tx, reaction) => {
        if (reaction.currentRunId && reaction.currentRunId !== input.runId)
          denied("Another foreground role is still running");
        const claimed = !reaction.currentRunId;
        return {
          claimed,
          reaction: await save(tx, { ...reaction, currentRunId: input.runId }),
        };
      });
    },
    /** A late result may be retained but can never release another foreground's qualification. */
    async settleRun(input: {
      subjectId: string;
      activityId: string;
      focus: ForegroundQualification;
      runId: string;
    }) {
      return mutateRun(input, false, async (tx, reaction) => {
        if (reaction.currentRunId !== input.runId)
          denied("The completed role is not this foreground's exact pending call");
        const { currentRunId: _, ...settled } = reaction;
        return save(tx, settled);
      });
    },
    /** Reserves one of the bounded short actions; same identity never executes twice. */
    async beginAction(input: {
      subjectId: string;
      activityId: string;
      focus: ForegroundQualification;
      actionId: string;
      action: InteractionAction;
    }) {
      const digest = digestCanonicalJson(
        "subject.reactor-action.v1",
        input as unknown as CanonicalJsonValue,
      ).hex;
      return mutate(async (tx) => {
        await lockSubjectNarrative(tx, input.subjectId);
        const existing = await sql<{ document: unknown; request_digest: string }>(
          tx,
          "SELECT a.document,a.request_digest FROM heptalogos.subject_reactor_action a JOIN heptalogos.subject_reaction r USING(reaction_id) WHERE r.subject_id=$1 AND a.action_id=$2",
          [input.subjectId, input.actionId],
        );
        if (existing[0]) {
          if (existing[0].request_digest !== digest)
            denied("An action identity cannot change its actual target or choice");
          return {
            claimed: false,
            receipt: checked<ReactorActionReceipt>(
              reactorActionReceiptSchema,
              existing[0].document,
            ),
          };
        }
        const reaction = await assertCurrentIn(
          tx,
          input.subjectId,
          input.activityId,
          input.focus,
        );
        if (reaction.currentRunId) denied("A foreground role is still running");
        if (reaction.stepCount >= reaction.policy.maxInteractionSteps)
          denied("This Reaction exhausted its short action budget");
        const unfinished = await sql(
          tx,
          "SELECT action_id FROM heptalogos.subject_reactor_action WHERE reaction_id=$1 AND document->>'state'='started'",
          [reaction.reactionId],
        );
        if (unfinished.length)
          denied("Reconcile the existing action instead of issuing another effect");
        const receipt = checked<ReactorActionReceipt>(reactorActionReceiptSchema, {
          actionId: input.actionId,
          reactionId: reaction.reactionId,
          step: reaction.stepCount + 1,
          action: input.action,
          state: "started",
          resultRefs: [],
          recordedAt: options.now(),
        });
        await sql(
          tx,
          "INSERT INTO heptalogos.subject_reactor_action(action_id,reaction_id,request_digest,document) VALUES($1,$2,$3,$4::jsonb)",
          [input.actionId, reaction.reactionId, digest, JSON.stringify(receipt)],
        );
        await save(tx, { ...reaction, stepCount: receipt.step });
        return { claimed: true, receipt };
      });
    },
    /** Actual effect results remain readable after revocation; this does not adopt a decision or send. */
    async finishAction(input: {
      subjectId: string;
      actionId: string;
      state: Exclude<ReactorActionReceipt["state"], "started">;
      resultRefs: readonly string[];
      problem?: ReactorActionReceipt["problem"];
    }) {
      return mutate(async (tx) => {
        await lockSubjectNarrative(tx, input.subjectId);
        const prior = await readAction(input.subjectId, input.actionId, tx);
        if (!prior) denied("The actual action reservation is missing");
        const receipt = checked<ReactorActionReceipt>(reactorActionReceiptSchema, {
          ...prior,
          state: input.state,
          resultRefs: [...new Set(input.resultRefs)],
          ...(input.problem ? { problem: input.problem } : {}),
        });
        if (input.problem && !["rejected", "unavailable"].includes(input.state))
          denied("Only a known rejected or unavailable action may carry a problem");
        if (prior.state !== "started") {
          if (JSON.stringify(prior) !== JSON.stringify(receipt))
            denied("An actual action receipt cannot be rewritten");
          return prior;
        }
        await sql(
          tx,
          "UPDATE heptalogos.subject_reactor_action SET document=$2::jsonb WHERE action_id=$1",
          [input.actionId, JSON.stringify(receipt)],
        );
        return receipt;
      });
    },
    /** Yield/completion requires a saved semantic continuation; no pending source becomes read. */
    async yield(input: {
      subjectId: string;
      activityId: string;
      focus: ForegroundQualification;
      continuationRef: string;
      reason: string;
      completed?: boolean;
      revoke?: boolean;
    }) {
      return mutate(async (tx) => {
        await lockSubjectNarrative(tx, input.subjectId);
        const actual = await current(input.subjectId, tx);
        if (
          !actual ||
          actual.reactionId !== input.focus.reactionId ||
          actual.focusRevision !== input.focus.focusRevision ||
          actual.activityId !== input.activityId
        )
          denied("The foreground already changed");
        if (actual.currentRunId && !input.revoke)
          denied("Wait for the safe native node before a normal yield");
        if (
          !input.revoke &&
          (
            await sql(
              tx,
              "SELECT action_id FROM heptalogos.subject_reactor_action WHERE reaction_id=$1 AND document->>'state'='started'",
              [actual.reactionId],
            )
          ).length
        )
          denied("Save the actual action receipt before a normal yield");
        const reaction = await save(tx, {
          ...actual,
          state: input.completed ? "completed" : "yielded",
          continuationRef: input.continuationRef,
          stopReason: input.reason,
        });
        await sql(
          tx,
          "UPDATE heptalogos.subject_foreground SET reaction_id=NULL,focus_revision=focus_revision+1,updated_at=$2 WHERE subject_id=$1",
          [input.subjectId, options.now()],
        );
        return reaction;
      });
    },
  };
}
