// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Restricts Bootstrap-authorized SQL operations to the explicit authority seam
 * required for Host database provisioning and ownership setup.
 * @module authorized-query
 */

import type { BootstrapAdminClient } from "./bootstrap-admin.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";

/** Executes a query only while Bootstrap mutation authority remains current. */
export async function queryWithAuthority<Row = never>(
  client: BootstrapAdminClient,
  authority: BootstrapMutationAuthority,
  text: string,
  values?: readonly unknown[],
): Promise<{ readonly rows: readonly Row[] }> {
  authority.assertCurrent();
  const result = await client.query<Row>(text, values);
  authority.assertCurrent();
  return result;
}
