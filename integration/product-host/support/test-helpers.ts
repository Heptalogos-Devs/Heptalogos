// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import type { ProductHostFixture, RunningHost } from "./fixture.js";

export interface IntegrationState {
  fixture?: ProductHostFixture;
  running?: RunningHost;
}

export async function cleanupIntegration(state: IntegrationState): Promise<void> {
  await state.running?.stop();
  await state.fixture?.cleanup();
}
