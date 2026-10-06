// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Appends and reads Bootstrap lifecycle journal checkpoints so recovery can
 * replay observed progress without treating history as current authority.
 * @module journal
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { readOptionalTextFile } from "./file-io.js";
import {
  canonicalizeJson,
  createProblem,
  type BootId,
  type InstallationId,
  type InstanceId,
  ProblemError,
  SHA256_HEX_PATTERN,
  type CanonicalJsonValue,
  type Problem,
  parseBootId,
  parseInstant,
  parseInstallationId,
  parseInstanceId,
  type ActivityId,
  UUID_V7_PATTERN,
} from "@heptalogos/foundation-contracts";
import type { BootstrapRuntimeGenerationId, ProductGenerationId } from "./model.js";
import { writeAtomicPublishedFile } from "./atomic-file.js";
import { KeyedAsyncSerializer } from "./keyed-serialization.js";

/** Gives journal entries the same Activity identity semantics as Foundation. */
export type BootstrapActivityId = ActivityId;
/** Enumerates lifecycle checkpoint outcomes recorded for recovery inspection. */
export type BootstrapStageOutcome = "STARTED" | "SUCCEEDED" | "FAILED";

/** Versioned checkpoint written before and after a Bootstrap lifecycle stage. */
export interface BootstrapJournalCheckpointV1 {
  readonly schemaVersion: 1;
  readonly bootId: BootId;
  readonly bootstrapActivityId: BootstrapActivityId;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly attemptedBootstrapRuntimeGeneration?: BootstrapRuntimeGenerationId;
  readonly attemptedProductGeneration?: ProductGenerationId;
  readonly stage: string;
  readonly at: string;
  readonly outcome: BootstrapStageOutcome;
  readonly problemCode?: string;
}

/** Creates a schema-versioned Bootstrap journal checkpoint. */
export function createBootstrapJournalCheckpoint(
  input: Omit<BootstrapJournalCheckpointV1, "schemaVersion">,
): BootstrapJournalCheckpointV1 {
  return { schemaVersion: 1, ...input };
}

/** Current checkpoint shape used by Bootstrap journal consumers. */
export type BootstrapJournalCheckpoint = BootstrapJournalCheckpointV1;

const checkpointSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    bootId: Type.String({ pattern: UUID_V7_PATTERN }),
    bootstrapActivityId: Type.String({ pattern: UUID_V7_PATTERN }),
    installationId: Type.String({ pattern: UUID_V7_PATTERN }),
    instanceId: Type.String({ pattern: UUID_V7_PATTERN }),
    attemptedBootstrapRuntimeGeneration: Type.Optional(
      Type.String({ pattern: SHA256_HEX_PATTERN }),
    ),
    attemptedProductGeneration: Type.Optional(
      Type.String({ pattern: SHA256_HEX_PATTERN }),
    ),
    stage: Type.String({ minLength: 1 }),
    at: Type.String({ minLength: 1 }),
    outcome: Type.Union([
      Type.Literal("STARTED"),
      Type.Literal("SUCCEEDED"),
      Type.Literal("FAILED"),
    ]),
    problemCode: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const journalSchema = Type.Array(checkpointSchemaV1);
const validateJournal =
  compileSchema<readonly BootstrapJournalCheckpoint[]>(journalSchema);
function journalProblem(problemCode: string, title: string, detail: string): Problem {
  return createProblem({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

function requireBootId(value: unknown): BootId {
  const bootId = parseBootId(value);
  if (!bootId) {
    throw new ProblemError(
      journalProblem(
        "bootstrap.journal.invalid_boot_id",
        "Bootstrap journal BootId is invalid",
        "BootId must be a valid RFC 9562 UUIDv7",
      ),
    );
  }
  return bootId;
}

function journalText(entries: readonly BootstrapJournalCheckpoint[]): string {
  return canonicalizeJson(entries as unknown as CanonicalJsonValue);
}

/** Appends and reads per-BootId Bootstrap journal checkpoints atomically. */
export class BootstrapJournal {
  private readonly journalDirectory: string;
  private readonly checkpointSerializer = new KeyedAsyncSerializer();

  /** Binds journal files to one Bootstrap lifecycle root. */
  constructor(private readonly directory: string) {
    this.journalDirectory = join(directory, "bootstrap-journal");
  }

  /** Appends a validated checkpoint while serializing same-boot writes. */
  async checkpoint(entry: BootstrapJournalCheckpointV1): Promise<void> {
    const bootId = requireBootId(entry.bootId);
    this.assertValidIdentities(entry);

    await this.checkpointSerializer.run(bootId, async () => {
      const existing = await this.readEntries(bootId);
      const entries = [...existing, entry];
      this.assertValidEntries(entries);
      await mkdir(this.journalDirectory, { recursive: true });
      await writeAtomicPublishedFile(this.fileFor(bootId), journalText(entries));
    });
  }

  /** Reads the validated checkpoint history for one BootId. */
  async read(bootId: BootId): Promise<readonly BootstrapJournalCheckpoint[]> {
    return this.readEntries(requireBootId(bootId));
  }

  private fileFor(bootId: unknown): string {
    const validatedBootId = requireBootId(bootId);
    return join(this.journalDirectory, `${validatedBootId}.json`);
  }

  private async readEntries(
    bootId: BootId,
  ): Promise<readonly BootstrapJournalCheckpoint[]> {
    const text = await readOptionalTextFile(this.fileFor(bootId));
    if (text === undefined) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_json",
          "Bootstrap journal is not valid JSON",
          "Bootstrap journal JSON could not be parsed",
        ),
      );
    }

    if (!validateJournal.validate(parsed).ok) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_entry",
          "Bootstrap journal contains an invalid entry",
          "Bootstrap journal checkpoint does not match the supported schema",
        ),
      );
    }

    const entries = parsed as BootstrapJournalCheckpoint[];
    if (entries.some((entry) => parseInstant(entry.at) === undefined)) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_entry",
          "Bootstrap journal contains an invalid entry",
          "Bootstrap journal checkpoint does not match the supported schema",
        ),
      );
    }
    if (entries.some((entry) => entry.bootId !== bootId)) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.boot_id_mismatch",
          "Bootstrap journal BootId does not match its file",
          "A per-BootId journal file contains a checkpoint for another boot",
        ),
      );
    }
    for (const entry of entries) this.assertValidIdentities(entry);
    return entries;
  }

  private assertValidEntries(entries: readonly BootstrapJournalCheckpoint[]): void {
    if (
      !validateJournal.validate(entries).ok ||
      entries.some((entry) => parseInstant(entry.at) === undefined)
    ) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_entry",
          "Bootstrap journal checkpoint is invalid",
          "Bootstrap journal checkpoint does not match the supported schema",
        ),
      );
    }
  }

  private assertValidIdentities(entry: BootstrapJournalCheckpointV1): void {
    if (!parseInstallationId(entry.installationId)) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_entry",
          "Bootstrap journal contains an invalid entry",
          "Bootstrap journal checkpoint does not match the supported schema",
        ),
      );
    }
    if (!parseInstanceId(entry.instanceId)) {
      throw new ProblemError(
        journalProblem(
          "bootstrap.journal.invalid_entry",
          "Bootstrap journal contains an invalid entry",
          "Bootstrap journal checkpoint does not match the supported schema",
        ),
      );
    }
  }
}

export type { BootId } from "@heptalogos/foundation-contracts";
