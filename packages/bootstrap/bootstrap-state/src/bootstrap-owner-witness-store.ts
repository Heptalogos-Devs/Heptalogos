// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the local durable Bootstrap owner witness store and its bounded cleanup
 * path, keeping filesystem mutation behind the BootstrapState package boundary.
 * @module bootstrap-owner-witness-store
 */

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createProblemError, ProblemError } from "@heptalogos/foundation-contracts";
import {
  canonicalBootstrapOwnerWitnessText,
  parseBootstrapOwnerWitness,
  sealBootstrapOwnerWitness,
} from "./bootstrap-owner-witness-codec.js";
import { hasNodeErrorCode } from "./file-io.js";
import type {
  BootstrapLockGenerationId,
  BootstrapOwnerWitnessBodyV1,
  BootstrapOwnerWitnessEnvelopeV1,
} from "./bootstrap-owner-witness-model.js";
import { writeAtomicPublishedFile } from "./atomic-file.js";

const OWNER_FILENAME = ".heptalogos-bootstrap-owner.json";
const ATTEMPT_DIRECTORY = ".heptalogos-bootstrap-attempts";
const RELEASING_DIRECTORY = ".heptalogos-bootstrap-releasing";

function storeProblem(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

function requirePhase(
  witness: BootstrapOwnerWitnessBodyV1,
  phase: BootstrapOwnerWitnessBodyV1["phase"],
): void {
  if (witness.phase !== phase) {
    throw storeProblem(
      "bootstrap.owner_witness.phase_mismatch",
      "Bootstrap owner witness phase is invalid",
      `Expected a ${phase} witness`,
    );
  }
}

async function jsonFileNames(directory: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
}

function requireValidEnvelope(
  text: string,
  path: string,
): BootstrapOwnerWitnessEnvelopeV1 {
  const parsed = parseBootstrapOwnerWitness(text);
  if (!parsed.ok) {
    throw createProblemError({
      ...parsed.problem,
      detail: `${parsed.problem.detail ?? parsed.problem.title}: ${path}`,
    });
  }
  return parsed.value;
}

/** Stores owner, attempt, and releasing witnesses under one instance root. */
export class BootstrapOwnerWitnessStore {
  private readonly ownerPath: string;
  private readonly attemptsPath: string;
  private readonly releasingPath: string;

  /** Binds this store to the canonical instance lifecycle root. */
  constructor(private readonly instanceRoot: string) {
    this.ownerPath = join(instanceRoot, OWNER_FILENAME);
    this.attemptsPath = join(instanceRoot, ATTEMPT_DIRECTORY);
    this.releasingPath = join(instanceRoot, RELEASING_DIRECTORY);
  }

  /** Reads the currently published owner witness, if one exists. */
  async readOwner(): Promise<BootstrapOwnerWitnessEnvelopeV1 | undefined> {
    return this.readOptional(this.ownerPath);
  }

  /** Publishes an OWNER witness and verifies the exact durable reload. */
  async publishOwner(
    witness: BootstrapOwnerWitnessBodyV1,
  ): Promise<BootstrapOwnerWitnessEnvelopeV1> {
    requirePhase(witness, "OWNER");
    const { validated, reloaded } = await this.publishWitness(this.ownerPath, witness);
    if (
      reloaded === undefined ||
      reloaded.witness.lockGenerationId !== witness.lockGenerationId ||
      reloaded.digest.hex !== validated.digest.hex
    ) {
      throw storeProblem(
        "bootstrap.owner_witness.publication_unverified",
        "Bootstrap owner witness publication is unverified",
        "The owner witness did not reload with the exact published generation and digest",
      );
    }
    return reloaded;
  }

  /** Publishes an ATTEMPT witness before provider lock acquisition. */
  async createAttempt(
    witness: BootstrapOwnerWitnessBodyV1,
  ): Promise<BootstrapOwnerWitnessEnvelopeV1> {
    requirePhase(witness, "ATTEMPT");
    await mkdir(this.attemptsPath, { recursive: true });
    const path = this.attemptPath(witness.lockGenerationId);
    return (await this.publishWitness(path, witness)).reloaded;
  }

  /** Lists and validates all outstanding ATTEMPT witnesses. */
  async listAttempts(): Promise<readonly BootstrapOwnerWitnessEnvelopeV1[]> {
    const witnesses = await Promise.all(
      (await jsonFileNames(this.attemptsPath)).map(async (name) => {
        const path = this.attemptPathFromName(name);
        return requireValidEnvelope(await readFile(path, "utf8"), path);
      }),
    );
    return witnesses;
  }

  /** Publishes a RELEASING witness before removing the current owner. */
  async publishReleasing(
    witness: BootstrapOwnerWitnessBodyV1 & { readonly phase: "RELEASING" },
  ): Promise<BootstrapOwnerWitnessEnvelopeV1> {
    requirePhase(witness, "RELEASING");
    await mkdir(this.releasingPath, { recursive: true });
    const path = this.releasingPathFor(witness.lockGenerationId);
    const { validated, reloaded: exact } = await this.publishWitness(path, witness);
    if (
      exact.witness.lockGenerationId !== witness.lockGenerationId ||
      exact.digest.hex !== validated.digest.hex
    ) {
      throw storeProblem(
        "bootstrap.owner_witness.releasing_publication_unverified",
        "Bootstrap releasing witness publication is unverified",
        "The releasing witness did not reload with the exact published generation and digest",
      );
    }
    return exact;
  }

  private async publishWitness(
    path: string,
    witness: BootstrapOwnerWitnessBodyV1,
  ): Promise<{
    readonly validated: BootstrapOwnerWitnessEnvelopeV1;
    readonly reloaded: BootstrapOwnerWitnessEnvelopeV1;
  }> {
    const sealed = sealBootstrapOwnerWitness(witness);
    const validated = requireValidEnvelope(JSON.stringify(sealed), path);
    await writeAtomicPublishedFile(path, canonicalBootstrapOwnerWitnessText(validated));
    const reloaded = requireValidEnvelope(await readFile(path, "utf8"), path);
    return { validated, reloaded };
  }

  /** Lists and validates witnesses left by interrupted release. */
  async listReleasing(): Promise<readonly BootstrapOwnerWitnessEnvelopeV1[]> {
    const witnesses = await Promise.all(
      (await jsonFileNames(this.releasingPath)).map(async (name) => {
        const path = this.releasingPathFromName(name);
        const value = requireValidEnvelope(await readFile(path, "utf8"), path);
        requirePhase(value.witness, "RELEASING");
        return value;
      }),
    );
    return witnesses;
  }

  /** Removes a releasing witness after its owner transition is complete. */
  async removeReleasing(lockGenerationId: BootstrapLockGenerationId): Promise<void> {
    await rm(this.releasingPathFor(lockGenerationId), { force: true });
  }

  /** Removes the current owner only when its generation still matches. */
  async removeCurrentOwnerWhileHeld(
    lockGenerationId: BootstrapLockGenerationId,
  ): Promise<void> {
    const current = await this.readOwner();
    if (
      current === undefined ||
      current.witness.lockGenerationId !== lockGenerationId
    ) {
      throw storeProblem(
        "bootstrap.owner_witness.owner_generation_mismatch",
        "Bootstrap owner witness generation changed",
        "The current owner witness did not match the generation being removed while the provider lock was held",
      );
    }
    await rm(this.ownerPath, { force: true });
  }

  /** Removes one failed or completed ownership attempt witness. */
  async removeAttempt(lockGenerationId: BootstrapLockGenerationId): Promise<void> {
    await rm(this.attemptPath(lockGenerationId), { force: true });
  }

  private async readOptional(
    path: string,
  ): Promise<BootstrapOwnerWitnessEnvelopeV1 | undefined> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (hasNodeErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
    return requireValidEnvelope(text, path);
  }

  private attemptPath(lockGenerationId: BootstrapLockGenerationId): string {
    return join(this.attemptsPath, `${lockGenerationId}.json`);
  }

  private attemptPathFromName(name: string): string {
    return join(this.attemptsPath, name);
  }

  private releasingPathFor(lockGenerationId: BootstrapLockGenerationId): string {
    return join(this.releasingPath, `${lockGenerationId}.json`);
  }

  private releasingPathFromName(name: string): string {
    return join(this.releasingPath, name);
  }
}
