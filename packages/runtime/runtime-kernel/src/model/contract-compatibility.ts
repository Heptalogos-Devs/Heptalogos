// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Evaluates runtime contract versions and ranges at the semantic boundary,
 * keeping compatibility decisions separate from provider implementation types.
 * @module contract-compatibility
 */

import type { ContractVersion, ContractVersionRange } from "./contracts.js";
import { runtimeKernelProblem } from "../problems.js";

/** Syntax accepted for exact Runtime contract versions. */
export const CONTRACT_VERSION_PATTERN = "^[a-z0-9][a-z0-9._-]{0,63}$";
const contractVersionShape = new RegExp(CONTRACT_VERSION_PATTERN, "u");

/** Parses a contract version without widening it into arbitrary text. */
export function parseContractVersion(value: unknown): ContractVersion | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    !contractVersionShape.test(value)
  ) {
    return undefined;
  }
  return value as ContractVersion;
}

/** Creates a validated exact Runtime contract version. */
export function createContractVersion(value: string): ContractVersion {
  const parsed = parseContractVersion(value);
  if (parsed === undefined) {
    throw new TypeError("Invalid exact ContractVersion");
  }
  return parsed;
}

/** Creates the exact-match range used by current Runtime requirements. */
export function exactContract(version: ContractVersion): ContractVersionRange {
  return Object.freeze({ kind: "exact", version });
}

/** Compares Service and Capability provider versions against requirements. */
export class ContractCompatibilityRegistry {
  /** Reports whether a provider satisfies the exact requested version. */
  isCompatible(
    requirement: ContractVersionRange,
    providerVersion: ContractVersion,
  ): boolean {
    if (requirement.kind !== "exact") return false;
    return requirement.version === providerVersion;
  }

  /** Throws a typed Problem when a provider version cannot satisfy the request. */
  assertCompatible(
    requirement: ContractVersionRange,
    providerVersion: ContractVersion,
    kind: "service" | "capability",
  ): void {
    if (!this.isCompatible(requirement, providerVersion)) {
      throw runtimeKernelProblem(
        `runtime.${kind}.incompatible_contract`,
        `No exact ${kind} contract match for ${requirement.version}`,
      );
    }
  }
}
