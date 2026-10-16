// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared generated-request type for the one discovered Gateway transport.
 * @module gateway-operation
 */
import type { createClient } from "./generated/client/index.js";
/** These fields are supplied by the existing Gateway client, rather than individual operation groups. */
interface GatewayRequestBase {
  readonly client: ReturnType<typeof createClient>;
  readonly throwOnError: true;
  readonly responseStyle: "fields";
  readonly signal?: AbortSignal;
}
/** A schema-generated operation uses the current discovery, authentication and cancellation. */
export type GatewayOperationRequest = <T>(
  operation: (base: GatewayRequestBase) => Promise<{ readonly data: T }>,
) => Promise<T>;
