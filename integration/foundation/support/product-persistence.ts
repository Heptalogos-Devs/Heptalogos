// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createPersistenceService } from "@heptalogos/persistence";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
} from "@heptalogos/execution-lineage";
import { createSystemTimeService } from "@heptalogos/time-service";
import {
  makeFixture,
  boot,
  stopManagedHostWithoutRuntime,
} from "./canonical-postgres.js";

export async function composeProductPersistence(
  fixture?: Awaited<ReturnType<typeof makeFixture>>,
  maxConnections = 8,
) {
  fixture ??= await makeFixture();
  const started = await boot(fixture);
  const time = createSystemTimeService();
  const runtime = createExecutionContextRuntime(
    {
      installationId: started.host.installationId,
      instanceId: started.host.instanceId,
      bootId: started.host.bootId,
      continuityEpochId: started.host.continuityEpochId,
      hostOwnershipToken: started.host.token,
    },
    time,
  );
  const persistence = createPersistenceService(
    started.host.persistence,
    {
      maxConnections,
      idleTimeoutMs: 5000,
      connectionTimeoutMs: 10000,
      statementTimeoutMs: 10000,
      lockTimeoutMs: 10000,
      idleInTransactionSessionTimeoutMs: 30000,
      onBackgroundError() {},
    },
    createPersistenceExecutionContextProvider(runtime),
  );
  const lineage = createExecutionLineageService();
  const run = <T>(operation: () => Promise<T>) =>
    runtime.runActivity(
      {
        kind: "qualification.messaging",
        importance: "routine",
        retentionClass: "operational",
        sensitivity: "operational",
      },
      async (context) => {
        await persistence.mutate((tx) => lineage.retainCurrent(tx, context));
        return operation();
      },
    );
  return {
    fixture,
    time,
    runtime,
    started,
    persistence,
    run,
    async close() {
      await persistence.close();
      await stopManagedHostWithoutRuntime(started.host);
    },
  };
}
