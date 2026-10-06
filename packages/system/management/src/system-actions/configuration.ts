// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime handlers for the current Configuration SystemAction family.
 * @module system-actions/configuration
 */

import type { ConfigurationDefinition } from "@heptalogos/configuration";
import type {
  ProductSemanticId,
  SystemActionRequest,
  TargetPrecondition,
} from "../contracts.js";
import {
  canonicalObject,
  configurationResourceId,
  precondition,
  resultField,
  type SystemActionContext,
  type SystemActionHandler,
} from "./types.js";
import { managementProblem } from "../problems.js";

type ConfigurationAction = Extract<
  SystemActionRequest,
  { readonly actionId: "configuration.revision.create" | "configuration.activate" }
>;

async function configurationDefinitionForAction(
  action: ConfigurationAction,
  context: SystemActionContext,
): Promise<ConfigurationDefinition> {
  const definitionId =
    action.actionId === "configuration.revision.create"
      ? action.input.definitionId
      : (await context.owners.configuration.getRevision(action.input.revisionId))
          ?.definitionId;
  if (definitionId === undefined) {
    throw contextProblem(
      "management.configuration_revision_not_found",
      "Configuration revision was not found",
      "The requested ConfigurationRevision is not current",
    );
  }
  const definition = context.owners.configuration.getDefinition(definitionId);
  if (definition === undefined) {
    throw contextProblem(
      "management.configuration_definition_not_found",
      "Configuration definition was not found",
      "The requested ConfigurationDefinition is not current",
    );
  }
  return definition;
}

function contextProblem(problemCode: string, title: string, detail: string): Error {
  return managementProblem(problemCode, title, detail, "conflict");
}

function normalized(
  action: ConfigurationAction,
  context: SystemActionContext,
): ConfigurationAction {
  if (action.actionId !== "configuration.revision.create") return action;
  const value = context.owners.configuration.validateValue(
    action.input.definitionId,
    action.input.value,
  );
  return Object.freeze({
    actionId: action.actionId,
    input: Object.freeze({ ...action.input, value }),
  });
}

function actionInput(action: SystemActionRequest): ConfigurationAction {
  return action as ConfigurationAction;
}

/** Creates the finite Configuration SystemAction handler. */
export function createConfigurationActionHandler(): SystemActionHandler {
  const handler: SystemActionHandler = {
    actionIds: Object.freeze([
      "configuration.revision.create",
      "configuration.activate",
    ]),
    normalize(request, context) {
      return normalized(actionInput(request), context);
    },
    async preconditions(request, context): Promise<readonly TargetPrecondition[]> {
      const action = actionInput(request);
      if (action.actionId === "configuration.revision.create") {
        const activation = await context.owners.configuration.getActivation(
          action.input.definitionId,
          action.input.scopeRef,
        );
        return Object.freeze([
          precondition(
            "configuration-scope",
            configurationResourceId(action.input.scopeRef),
            activation,
          ),
        ]);
      }
      const revision = await context.owners.configuration.getRevision(
        action.input.revisionId,
      );
      if (revision === undefined) {
        throw contextProblem(
          "management.configuration_revision_not_found",
          "Configuration revision was not found",
          "The requested ConfigurationRevision is not current",
        );
      }
      const activation = await context.owners.configuration.getActivation(
        revision.definitionId,
        revision.scopeRef,
      );
      return Object.freeze([
        precondition("configuration-revision", revision.revisionId, revision),
        precondition(
          "configuration-scope",
          configurationResourceId(revision.scopeRef),
          activation,
        ),
      ]);
    },
    async affectedOwners(request, context): Promise<readonly ProductSemanticId[]> {
      const definition = await configurationDefinitionForAction(
        actionInput(request),
        context,
      );
      return Object.freeze(
        [
          "system.configuration" as ProductSemanticId,
          definition.owner as ProductSemanticId,
        ].filter((owner, index, owners) => owners.indexOf(owner) === index),
      );
    },
    async impact(request, context) {
      const action = actionInput(request);
      const definition = await configurationDefinitionForAction(action, context);
      const staged = action.actionId === "configuration.revision.create";
      const activation = definition.activation;
      const restartRequired =
        !staged &&
        (activation === "RESTART_COMPONENT" ||
          activation === "RESTART_SUBJECT" ||
          activation === "RESTART_HOST" ||
          activation === "MAINTENANCE" ||
          activation === "NEXT_BOOT" ||
          activation === "IMMUTABLE_AFTER_INIT");
      const reconciliation = staged
        ? "staged-until-activation"
        : activation === "LIVE"
          ? "immediate"
          : activation === "RELOAD_COMPONENT"
            ? "reload-component"
            : activation === "RESTART_COMPONENT"
              ? "restart-component"
              : activation === "RESTART_SUBJECT"
                ? "restart-subject"
                : activation === "RESTART_HOST"
                  ? "restart-host"
                  : activation === "MAINTENANCE"
                    ? "maintenance"
                    : activation === "NEXT_BOOT"
                      ? "next-boot"
                      : "immutable-after-init";
      return {
        readiness: Object.freeze({
          configurationDefinitionId: definition.definitionId,
          activation,
          consumerRefs: Object.freeze([...definition.consumerRefs]),
          effective: staged ? "after-activation" : "active-revision",
        }),
        restart: Object.freeze({ restartRequired, activation, reconciliation }),
      };
    },
    async execute(
      request,
      context,
    ): Promise<import("@heptalogos/foundation-contracts").CanonicalJsonValue> {
      const action = actionInput(request);
      if (action.actionId === "configuration.revision.create") {
        return canonicalObject(
          await context.owners.configuration.createRevision({
            definitionId: action.input.definitionId,
            scopeRef: action.input.scopeRef,
            value: action.input.value,
          }),
        ).value;
      }
      return canonicalObject(
        await context.owners.configuration.activate({
          revisionId: action.input.revisionId,
          ...(action.input.expectedActiveRevisionId === undefined
            ? {}
            : { expectedActiveRevisionId: action.input.expectedActiveRevisionId }),
        }),
      ).value;
    },
    async verify(request, result, context) {
      const action = actionInput(request);
      if (action.actionId === "configuration.revision.create") {
        const revisionId = resultField(result, "revisionId");
        return (
          revisionId !== undefined &&
          (await context.owners.configuration.getRevision(revisionId)) !== undefined
        );
      }
      const revision = await context.owners.configuration.getRevision(
        action.input.revisionId,
      );
      if (revision === undefined) return false;
      const activation = await context.owners.configuration.getActivation(
        revision.definitionId,
        revision.scopeRef,
      );
      return activation?.activeRevisionId === action.input.revisionId;
    },
    expectedDigest() {
      return undefined;
    },
    reconcilesSubjectRuntime(request) {
      return (request as ConfigurationAction).actionId === "configuration.activate";
    },
  };
  return Object.freeze(handler);
}
