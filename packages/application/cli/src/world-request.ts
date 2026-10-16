// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Builds explicit world owner requests from ordinary CLI flags. @module world-request */
import { CliFailure } from "./base-command.js";
/** CLI names route to generated owner operations; none of them reads private storage. */
export const worldOperations = {
  configure: "worldConfigure",
  read: "worldRead",
  prepare: "worldPrepare",
  realize: "worldRealize",
  "advance-rules": "worldAdvanceRules",
  advance: "advanceWorldOpportunity",
  query: "worldQuery",
  history: "worldHistory",
  coverage: "worldCoverage",
  "actor-resolve": "worldActorResolve",
  actors: "worldActors",
} as const;
/** Named flags remain a presentation shape; the owner validates the actual wire contract. */
export type WorldFlags = Record<string, unknown>;
function required(flags: WorldFlags, key: string): string {
  const value = flags[key];
  if (typeof value !== "string" || !value)
    throw new CliFailure("cli.required_flag", `该操作需要 --${key}。`, 2);
  return value;
}
/** Complex mutations require exact input; ordinary reads use IDs and bounded ranges. */
export function worldRequest(
  operation: keyof typeof worldOperations,
  flags: WorldFlags,
  document?: unknown,
): unknown {
  if (operation === "configure" || operation === "realize") {
    if (!document || typeof document !== "object" || Array.isArray(document))
      throw new CliFailure(
        "cli.invalid_json",
        "configure/realize 需要 --file 或 --stdin 提供完整 owner 请求。",
        2,
      );
    return document;
  }
  const subjectId = required(flags, "subject-id"),
    worldId = required(flags, "world-id");
  const base = { subjectId, worldId };
  const range = () => ({
    timeDomainRef: required(flags, "domain"),
    start: required(flags, "from"),
    end: required(flags, "to"),
  });
  switch (operation) {
    case "read":
    case "prepare":
      return base;
    case "actor-resolve":
      return { ...base, actorKey: required(flags, "actor-key") };
    case "actors":
      if (!Array.isArray(flags["entity-ref"]) || !flags["entity-ref"].length)
        throw new CliFailure(
          "cli.required_flag",
          "actors 需要至少一个 --entity-ref；完整世界人物列表使用 read。",
          2,
        );
      return {
        ...base,
        entityRefs: Array.isArray(flags["entity-ref"]) ? flags["entity-ref"] : [],
      };
    case "advance":
      return {
        ...base,
        activityId: required(flags, "activity-id"),
        requestId: required(flags, "request-id"),
      };
    case "advance-rules":
      return { ...base, interval: range() };
    case "coverage":
      return {
        ...base,
        interval: range(),
        ...(flags["as-recorded-at"] ? { asRecordedAt: flags["as-recorded-at"] } : {}),
      };
    case "history":
      return {
        ...base,
        limit: flags.limit ?? 50,
        ...(flags["after-revision"] !== undefined
          ? { afterRevision: flags["after-revision"] }
          : {}),
      };
    case "query":
      return {
        ...base,
        interval: range(),
        view: flags.view ?? "subject",
        limit: flags.limit ?? 50,
        ...(flags["after-event-id"] ? { afterEventId: flags["after-event-id"] } : {}),
        ...(flags["as-recorded-at"] ? { asRecordedAt: flags["as-recorded-at"] } : {}),
        ...(flags["knowledge-at"]
          ? {
              knowledgeAtWorldTime: {
                timeDomainRef: required(flags, "domain"),
                at: flags["knowledge-at"],
              },
            }
          : {}),
      };
  }
}
