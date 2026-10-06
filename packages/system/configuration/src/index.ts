// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public current Configuration contracts and managed-revision service.
 * @packageDocumentation
 */

export {
  configurationActivateInputSchema,
  configurationRevisionCreateInputSchema,
  configurationScopeRefSchema,
  type ActivateConfigurationInput,
  type ConfigurationActivation,
  type ConfigurationDefinition,
  type ConfigurationDefinitionId,
  type ConfigurationRevision,
  type ConfigurationRevisionId,
  type ConfigurationScopeRef,
  type ConfigurationService,
  type ConfigurationServiceOptions,
  type CreateConfigurationRevisionInput,
} from "./contracts.js";
export { createConfigurationService } from "./service.js";
