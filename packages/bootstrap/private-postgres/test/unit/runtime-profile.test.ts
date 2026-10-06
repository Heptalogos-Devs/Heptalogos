// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createCanonicalHbaProfile,
  createCanonicalRuntimeProfile,
} from "../../src/runtime-profile.js";

describe("private PostgreSQL canonical runtime profile", () => {
  it("materializes deterministic runtime settings for the persisted port", () => {
    expect(createCanonicalRuntimeProfile(55432)).toBe(
      "listen_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = 55432\npassword_encryption = 'scram-sha-256'\n",
    );
  });

  it("materializes only loopback TCP SCRAM HBA rules", () => {
    expect(createCanonicalHbaProfile()).toBe(
      "# Heptalogos private PostgreSQL HBA profile v1\nhost all all 127.0.0.1/32 scram-sha-256\n",
    );
    expect(createCanonicalHbaProfile()).not.toContain("trust");
    expect(createCanonicalHbaProfile()).not.toContain("local ");
  });
});
