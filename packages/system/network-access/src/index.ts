// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public current NetworkAccess policy and controlled gateway transport.
 * @packageDocumentation
 */

export {
  GATEWAY_TRANSPORT_DEFINITION_ID,
  gatewayTransportConfigSchema,
  gatewayTransportConfigurationDefinition,
  networkAccessDiagnosticsSchema,
  networkAccessPolicySchema,
  type GatewayTransportConfigV1,
  type GatewayNetworkProtocol,
  type GatewayNetworkTarget,
  type NetworkAccessDiagnostics,
  type NetworkAccessPolicy,
  type NetworkAccessService,
  type NetworkAccessServiceOptions,
  type NetworkResponseKnowledge,
} from "./contracts.js";
export { createNetworkAccessService } from "./service.js";
