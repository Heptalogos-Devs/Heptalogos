// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the crash-safe BootstrapState store, combining keyed serialization,
 * atomic files, and explicit revision loading under one durable owner.
 * @module store
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalizeJson,
  createProblem,
  ProblemError,
  type CanonicalJsonValue,
  type Problem,
} from "@heptalogos/foundation-contracts";
import { parseBootstrapState, sealBootstrapState } from "./codec.js";
import { writeAtomicPublishedFile } from "./atomic-file.js";
import type { BootstrapStateBody, BootstrapStateEnvelope } from "./model.js";
import { readOptionalTextFile } from "./file-io.js";

const CURRENT_FILENAME = "bootstrap-state.json";
const PREVIOUS_FILENAME = "bootstrap-state.previous.json";

/** Reports the current/previous durable BootstrapState revision status. */
export type BootstrapStateLoadResult =
  | { readonly status: "EMPTY" }
  | { readonly status: "CURRENT"; readonly value: BootstrapStateEnvelope }
  | {
      readonly status: "RECOVERED_PREVIOUS";
      readonly value: BootstrapStateEnvelope;
      readonly problem: Problem;
    }
  | { readonly status: "CORRUPT"; readonly problem: Problem };

type Candidate =
  | { readonly kind: "MISSING" }
  | { readonly kind: "INVALID"; readonly problem: Problem }
  | { readonly kind: "VALID"; readonly value: BootstrapStateEnvelope };

function storeProblem(problemCode: string, title: string, detail: string): Problem {
  return createProblem({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

function stateText(value: BootstrapStateEnvelope): string {
  return canonicalizeJson(value as unknown as CanonicalJsonValue);
}

/** Owns atomic current/previous BootstrapState publication for one directory. */
export class BootstrapStateStore {
  private readonly currentPath: string;
  private readonly previousPath: string;

  /** Binds the store to the BootstrapState directory. */
  constructor(private readonly directory: string) {
    this.currentPath = join(directory, CURRENT_FILENAME);
    this.previousPath = join(directory, PREVIOUS_FILENAME);
  }

  /** Loads current state, recovering a previous valid revision for inspection only. */
  async load(): Promise<BootstrapStateLoadResult> {
    const current = await this.readCandidate(this.currentPath);
    if (current.kind === "VALID") {
      return { status: "CURRENT", value: current.value };
    }

    const previous = await this.readCandidate(this.previousPath);
    if (previous.kind === "VALID") {
      const problem =
        current.kind === "MISSING"
          ? storeProblem(
              "bootstrap.state.current_missing",
              "Current BootstrapState is missing",
              "The previous valid BootstrapState revision was recovered",
            )
          : storeProblem(
              "bootstrap.state.current_corrupt",
              "Current BootstrapState is corrupt",
              "The previous valid BootstrapState revision was recovered",
            );
      return {
        status: "RECOVERED_PREVIOUS",
        value: previous.value,
        problem,
      };
    }

    if (current.kind === "MISSING" && previous.kind === "MISSING") {
      return { status: "EMPTY" };
    }

    if (current.kind === "INVALID" && previous.kind === "MISSING") {
      return { status: "CORRUPT", problem: current.problem };
    }

    return {
      status: "CORRUPT",
      problem: storeProblem(
        "bootstrap.state.no_valid_revision",
        "No valid BootstrapState revision is available",
        "Current and previous BootstrapState files are missing or invalid",
      ),
    };
  }

  /** Commits the next revision and verifies the exact durable reload. */
  async commit(candidate: BootstrapStateBody): Promise<BootstrapStateEnvelope> {
    const sealed = sealBootstrapState(candidate);
    const validated = parseBootstrapState(JSON.stringify(sealed));
    if (!validated.ok) throw new ProblemError(validated.problem);

    const current = await this.load();
    if (current.status === "CORRUPT") {
      throw new ProblemError(current.problem);
    }
    if (current.status === "RECOVERED_PREVIOUS") {
      throw new ProblemError(
        storeProblem(
          "bootstrap.state.current_authority_required",
          "Current BootstrapState authority is required",
          "A previous BootstrapState revision is recovery evidence only and cannot authorize mutation",
        ),
      );
    }
    const expectedRevision =
      current.status === "EMPTY" ? 1 : current.value.state.revision + 1;
    if (validated.value.state.revision !== expectedRevision) {
      throw new ProblemError(
        storeProblem(
          "bootstrap.state.revision_conflict",
          "BootstrapState revision conflict",
          `Expected revision ${expectedRevision}, got ${validated.value.state.revision}`,
        ),
      );
    }

    await mkdir(this.directory, { recursive: true });
    if (current.status !== "EMPTY") {
      await writeAtomicPublishedFile(this.previousPath, stateText(current.value));
    }
    await writeAtomicPublishedFile(this.currentPath, stateText(validated.value));

    const committed = await this.readCandidate(this.currentPath);
    if (committed.kind !== "VALID") {
      throw new ProblemError(
        storeProblem(
          "bootstrap.state.commit_verification_failed",
          "Committed BootstrapState could not be verified",
          "The newly written current state did not reload with the expected revision and digest",
        ),
      );
    }
    if (
      committed.value.state.revision !== validated.value.state.revision ||
      committed.value.digest.hex !== validated.value.digest.hex
    ) {
      throw new ProblemError(
        storeProblem(
          "bootstrap.state.commit_verification_failed",
          "Committed BootstrapState could not be verified",
          "The newly written current state did not reload with the expected revision and digest",
        ),
      );
    }
    return committed.value;
  }

  private async readCandidate(path: string): Promise<Candidate> {
    const text = await readOptionalTextFile(path);
    if (text === undefined) return { kind: "MISSING" };

    const result = parseBootstrapState(text);
    return result.ok
      ? { kind: "VALID", value: result.value }
      : { kind: "INVALID", problem: result.problem };
  }
}
