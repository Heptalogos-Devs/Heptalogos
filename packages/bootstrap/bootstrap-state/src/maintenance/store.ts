// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns durable maintenance journal storage and atomic record replacement so a
 * recovery process can observe one coherent operation state at a time.
 * @module maintenance/store
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalizeJson,
  createProblem,
  parseUuidV7Id,
  ProblemError,
  type CanonicalJsonValue,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  canonicalMaintenanceJournalText,
  parseMaintenanceJournal,
  sealMaintenanceJournal,
} from "./codec.js";
import type {
  MaintenanceJournalBodyV1,
  MaintenanceJournalEnvelopeV1,
  MaintenanceJournalLoadResult,
  MaintenanceOperationId,
} from "./model.js";
import { writeAtomicPublishedFile } from "../atomic-file.js";
import { KeyedAsyncSerializer } from "../keyed-serialization.js";
import { readOptionalTextFile } from "../file-io.js";

const CURRENT_FILENAME = "maintenance-state.json";
const PREVIOUS_FILENAME = "maintenance-state.previous.json";

type Candidate =
  | { readonly kind: "MISSING" }
  | { readonly kind: "INVALID"; readonly problem: Problem }
  | { readonly kind: "VALID"; readonly value: MaintenanceJournalEnvelopeV1 };

function storeProblem(problemCode: string, title: string, detail: string): Problem {
  return createProblem({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

function operationId(value: unknown): MaintenanceOperationId {
  const parsed = parseUuidV7Id("MaintenanceOperationId", value);
  if (parsed === undefined) {
    throw new ProblemError(
      storeProblem(
        "maintenance.journal.invalid_operation_id",
        "Maintenance operation identity is invalid",
        "MaintenanceJournal paths require a valid UUIDv7 MaintenanceOperationId",
      ),
    );
  }
  return parsed;
}

function pathFor(root: string, id: MaintenanceOperationId): string {
  return join(root, "maintenance-journal", id);
}

function stateText(value: MaintenanceJournalEnvelopeV1): string {
  return canonicalizeJson(value as unknown as CanonicalJsonValue);
}

/** Owns serialized, atomic MaintenanceJournal revisions for one instance. */
export class MaintenanceJournalStore {
  private readonly operationSerializer = new KeyedAsyncSerializer();

  /** Binds the journal store to an instance root and optional authority check. */
  constructor(
    private readonly instanceRoot: string,
    private readonly assertAuthority?: () => void,
  ) {}

  /** Loads the current journal result for one operation. */
  async load(operation: MaintenanceOperationId): Promise<MaintenanceJournalLoadResult> {
    this.assertAuthority?.();
    const id = operationId(operation);
    return this.operationSerializer.run(id, () => {
      this.assertAuthority?.();
      return this.loadUnlocked(id);
    });
  }

  /** Creates revision one after confirming the operation does not already exist. */
  async create(body: MaintenanceJournalBodyV1): Promise<MaintenanceJournalEnvelopeV1> {
    const id = operationId(body.operationId);
    return this.operationSerializer.run(id, async () => {
      this.assertAuthority?.();
      const existing = await this.loadUnlocked(id);
      if (existing.status !== "EMPTY") {
        throw new ProblemError(
          storeProblem(
            "maintenance.journal.already_exists",
            "Maintenance journal already exists",
            "A MaintenanceJournal operation cannot be created over an existing operation",
          ),
        );
      }
      if (body.revision !== 1) {
        throw new ProblemError(
          storeProblem(
            "maintenance.journal.revision_conflict",
            "Maintenance journal revision is not the initial revision",
            "The first MaintenanceJournal revision must be 1",
          ),
        );
      }
      return this.publishUnlocked(id, body, undefined);
    });
  }

  /** Advances one operation serially after checking revision and authority. */
  async advance(body: MaintenanceJournalBodyV1): Promise<MaintenanceJournalEnvelopeV1> {
    const id = operationId(body.operationId);
    return this.operationSerializer.run(id, async () => {
      this.assertAuthority?.();
      const current = await this.loadUnlocked(id);
      if (current.status === "EMPTY") {
        throw new ProblemError(
          storeProblem(
            "maintenance.journal.not_found",
            "Maintenance journal does not exist",
            "A MaintenanceJournal revision cannot advance before revision 1 is created",
          ),
        );
      }
      if (current.status === "CORRUPT") {
        throw new ProblemError(current.problem);
      }
      if (current.status === "RECOVERED_PREVIOUS") {
        throw new ProblemError(
          storeProblem(
            "maintenance.journal.current_authority_required",
            "Current MaintenanceJournal authority is required",
            "A previous MaintenanceJournal revision is recovery evidence only and cannot authorize mutation",
          ),
        );
      }
      const expectedRevision = current.value.state.revision + 1;
      if (body.revision !== expectedRevision) {
        throw new ProblemError(
          storeProblem(
            "maintenance.journal.revision_conflict",
            "Maintenance journal revision conflict",
            `Expected revision ${expectedRevision}, got ${body.revision}`,
          ),
        );
      }
      return this.publishUnlocked(id, body, current.value);
    });
  }

  private async publishUnlocked(
    id: MaintenanceOperationId,
    body: MaintenanceJournalBodyV1,
    previous: MaintenanceJournalEnvelopeV1 | undefined,
  ): Promise<MaintenanceJournalEnvelopeV1> {
    const sealed = sealMaintenanceJournal(body);
    const parsed = parseMaintenanceJournal(stateText(sealed));
    if (!parsed.ok) throw new ProblemError(parsed.problem);

    const directory = pathFor(this.instanceRoot, id);
    this.assertAuthority?.();
    await mkdir(directory, { recursive: true });
    if (previous !== undefined) {
      this.assertAuthority?.();
      await writeAtomicPublishedFile(
        join(directory, PREVIOUS_FILENAME),
        canonicalMaintenanceJournalText(previous),
      );
    }
    this.assertAuthority?.();
    await writeAtomicPublishedFile(
      join(directory, CURRENT_FILENAME),
      canonicalMaintenanceJournalText(parsed.value),
    );

    this.assertAuthority?.();
    const committed = await this.readCandidate(join(directory, CURRENT_FILENAME));
    if (
      committed.kind !== "VALID" ||
      committed.value.state.revision !== body.revision ||
      committed.value.digest.hex !== parsed.value.digest.hex
    ) {
      throw new ProblemError(
        storeProblem(
          "maintenance.journal.commit_verification_failed",
          "Committed MaintenanceJournal could not be verified",
          "The newly written MaintenanceJournal revision did not reload with the expected digest",
        ),
      );
    }
    return committed.value;
  }

  private async loadUnlocked(
    id: MaintenanceOperationId,
  ): Promise<MaintenanceJournalLoadResult> {
    this.assertAuthority?.();
    const directory = pathFor(this.instanceRoot, id);
    const current = await this.readCandidate(join(directory, CURRENT_FILENAME));
    const previous = await this.readCandidate(join(directory, PREVIOUS_FILENAME));

    if (current.kind === "VALID") {
      if (current.value.state.operationId !== id) {
        return {
          status: "CORRUPT",
          problem: storeProblem(
            "maintenance.journal.operation_id_mismatch",
            "Maintenance journal operation identity does not match its path",
            "The current MaintenanceJournal body does not match the operation directory",
          ),
        };
      }
      return { status: "CURRENT", value: current.value };
    }

    if (previous.kind === "VALID") {
      if (previous.value.state.operationId !== id) {
        return {
          status: "CORRUPT",
          problem: storeProblem(
            "maintenance.journal.operation_id_mismatch",
            "Maintenance journal operation identity does not match its path",
            "The previous MaintenanceJournal body does not match the operation directory",
          ),
        };
      }
      return {
        status: "RECOVERED_PREVIOUS",
        value: previous.value,
        problem:
          current.kind === "MISSING"
            ? storeProblem(
                "maintenance.journal.current_missing",
                "Current MaintenanceJournal revision is missing",
                "The previous valid MaintenanceJournal revision was recovered",
              )
            : current.problem,
      };
    }

    if (current.kind === "MISSING" && previous.kind === "MISSING") {
      return { status: "EMPTY" };
    }

    return {
      status: "CORRUPT",
      problem: storeProblem(
        "maintenance.journal.no_valid_revision",
        "No valid MaintenanceJournal revision is available",
        "Current and previous MaintenanceJournal files are missing or invalid",
      ),
    };
  }

  private async readCandidate(path: string): Promise<Candidate> {
    const text = await readOptionalTextFile(path);
    if (text === undefined) return { kind: "MISSING" };

    const parsed = parseMaintenanceJournal(text);
    return parsed.ok
      ? { kind: "VALID", value: parsed.value }
      : { kind: "INVALID", problem: parsed.problem };
  }
}
