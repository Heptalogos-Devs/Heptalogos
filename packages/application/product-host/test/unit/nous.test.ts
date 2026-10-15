// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, expect, it, vi } from "vitest";
import { connectNousInstance } from "@nous-wave/client/node";
import { createNousSubject } from "../../src/nous.js";
import type { ProductSettings } from "@heptalogos/management";

vi.mock("@nous-wave/client/node", () => ({ connectNousInstance: vi.fn() }));
const create = vi.fn(async () => ({ subjectId: "created-subject", status: "active" }));
const settings: ProductSettings = {
  nous: { runRoot: "/nous/run", expectedInstanceId: "instance-one" },
  subject: { id: null, enabled: false },
  subjectGateway: { origin: "http://127.0.0.1:19471" },
  maintenanceGateway: { origin: "http://127.0.0.1:19472" },
};
beforeEach(() => {
  create.mockClear();
  vi.mocked(connectNousInstance).mockResolvedValue({
    instanceId: "instance-one",
    subjects: { createSubject: create },
  } as never);
});

it.each([
  ["markdown", "text/markdown"],
  ["toml", "application/vnd.nous-wave.cognitive-seed+toml;version=1"],
] as const)(
  "creates a Subject with the Nous-owned %s Seed wire format",
  async (format, wire) => {
    await createNousSubject(settings, {
      operationId: "operation-one",
      capabilities: { memory: true, selfCognition: true },
      seed: { format, text: "schema_version = 1\n" },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        cognitiveSeed: { format: wire, text: "schema_version = 1\n" },
      }),
      expect.anything(),
    );
  },
);
