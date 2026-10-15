// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import type { ConfigurationService } from "@heptalogos/configuration";
import { ProductManagement, type ProductSettings } from "../../src/product.js";

const settings: ProductSettings = {
  nous: { runRoot: "/nous/one/run", expectedInstanceId: "instance-one" },
  subject: { id: "b70fd64b-cffc-4211-84df-11867f5687ef", enabled: true },
  subjectGateway: { origin: "http://127.0.0.1:19471" },
  maintenanceGateway: { origin: "http://127.0.0.1:19472" },
};

function fixture() {
  const mutate = vi.fn();
  const get = vi.fn();
  const product = new ProductManagement({
    configuration: {
      getEffectiveRevision: async () => ({
        revisionId: "revision-one",
        value: settings,
      }),
    } as unknown as ConfigurationService,
    installationId: "installation-one",
    bootId: "boot-one",
    startedAt: new Date(0).toISOString(),
    dependencies: async () => [],
    runMutation: mutate,
    subjects: { get, create: vi.fn() },
  });
  return { product, mutate, get };
}

describe("active Subject binding authority", () => {
  it.each([
    {
      ...settings,
      subject: { ...settings.subject, id: "6ac84ba0-0463-4567-a84c-02f2b7ade66f" },
    },
    { ...settings, nous: { ...settings.nous, runRoot: "/nous/two/run" } },
    { ...settings, nous: { ...settings.nous, expectedInstanceId: "instance-two" } },
  ])(
    "rejects replacement of the Subject or its cognition owner before any remote read or mutation",
    async (replacement) => {
      const { product, mutate, get } = fixture();
      await expect(
        product.configure(replacement, "revision-one"),
      ).rejects.toMatchObject({
        problem: { problemCode: "management.subject_active" },
      });
      expect(get).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    },
  );
});
