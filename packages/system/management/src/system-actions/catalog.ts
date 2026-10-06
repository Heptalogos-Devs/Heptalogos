// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Finite runtime catalog for the current Product SystemAction identifiers.
 * This is a closed internal mapping, not a plugin registration mechanism.
 * @module system-actions/catalog
 */

import {
  currentSystemActionCatalog,
  type ProductSystemActionId,
  type SystemActionDefinition,
} from "../contracts.js";
import { managementProblem } from "../problems.js";
import { createAIRuntimeActionHandler } from "./ai-runtime.js";
import { createConfigurationActionHandler } from "./configuration.js";
import { createSecretActionHandler } from "./secret.js";
import { createSubjectActionHandler } from "./subject.js";
import type { SystemActionHandler } from "./types.js";

/** Provides the closed current SystemAction-to-handler mapping. */
export interface SystemActionCatalog {
  readonly handlers: readonly SystemActionHandler[];
  /** Returns the unique handler for one current action identifier. */
  handlerFor(actionId: ProductSystemActionId): SystemActionHandler;
  /** Returns the canonical definition for one current action identifier. */
  definitionFor(actionId: ProductSystemActionId): SystemActionDefinition;
}

/** Builds and validates the exact current action-id-to-family mapping. */
function createSystemActionCatalog(): SystemActionCatalog {
  const handlers = Object.freeze([
    createConfigurationActionHandler(),
    createSecretActionHandler(),
    createAIRuntimeActionHandler(),
    createSubjectActionHandler(),
  ]);
  const byId = new Map<ProductSystemActionId, SystemActionHandler>();
  for (const handler of handlers) {
    for (const actionId of handler.actionIds) {
      if (byId.has(actionId)) {
        throw managementProblem(
          "management.action_catalog_invalid",
          "SystemAction catalog has duplicate ownership",
          `The current action ${actionId} is owned by more than one runtime handler`,
          "integrity",
        );
      }
      byId.set(actionId, handler);
    }
  }
  for (const definition of currentSystemActionCatalog) {
    if (!byId.has(definition.actionId as ProductSystemActionId)) {
      throw managementProblem(
        "management.action_catalog_invalid",
        "SystemAction catalog is incomplete",
        `The current action ${definition.actionId} has no runtime handler`,
        "integrity",
      );
    }
  }
  if (byId.size !== currentSystemActionCatalog.length) {
    throw managementProblem(
      "management.action_catalog_invalid",
      "SystemAction catalog has unknown ownership",
      "The runtime handler set contains an action that is not in the static current catalog",
      "integrity",
    );
  }
  const catalog: SystemActionCatalog = {
    handlers,
    handlerFor(actionId: ProductSystemActionId) {
      const handler = byId.get(actionId);
      if (handler === undefined) {
        throw managementProblem(
          "management.invalid_input",
          "SystemAction is not current",
          "The requested SystemAction is not current",
          "validation",
        );
      }
      return handler;
    },
    definitionFor(actionId: ProductSystemActionId) {
      const definition = currentSystemActionCatalog.find(
        (candidate) => candidate.actionId === actionId,
      );
      if (definition === undefined) {
        throw managementProblem(
          "management.invalid_input",
          "SystemAction is not current",
          "The requested SystemAction is not current",
          "validation",
        );
      }
      return definition;
    },
  };
  return Object.freeze(catalog);
}

/** The validated finite catalog used by the Management service. */
export const systemActionCatalog = createSystemActionCatalog();
