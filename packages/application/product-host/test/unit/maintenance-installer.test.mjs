// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { maintenanceGatewayServiceUnit } from "../../../../../scripts/package/configure-maintenance.mjs";
import { subjectGatewayServiceUnit } from "../../../../../scripts/package/install-linux-product.mjs";
describe("installed native service lifecycle ownership", () => {
  it("keeps operator maintenance independent while Subject follows its exact Host", () => {
    const options = {
      node: "/installed/node",
      anchorRoot: "/installed root",
      hostUnit: "exact-host.service",
      nativeEntry: "/installed/native.mjs",
      prepareEntry: "/installed/prepare.mjs",
      profilePath: "/isolated/config/openclaw.json",
      stateRoot: "/isolated/data",
      passwordFile: "/isolated/secret/password",
      environmentFile: "/existing private/gateway.env",
      logPath: "/isolated/run/gateway.log",
    };
    const maintenance = maintenanceGatewayServiceUnit(options);
    expect(maintenance).not.toContain("Requires=");
    expect(maintenance).not.toContain("PartOf=");
    expect(maintenance).not.toContain("ExecStartPre=");
    expect(maintenance).not.toContain(options.hostUnit);
    expect(maintenance).toContain("WorkingDirectory=/installed root\n");
    expect(maintenance).toContain('"--env-file=/existing private/gateway.env"');
    expect(maintenance).toContain("OPENCLAW_STATE_DIR=/isolated/data");
    expect(maintenance).toContain('"--password-file" "/isolated/secret/password"');
    const subject = subjectGatewayServiceUnit(options);
    expect(subject).toContain("Requires=exact-host.service");
    expect(subject).toContain("PartOf=exact-host.service");
    expect(subject).toContain("ExecStartPre=");
    expect(subject).toContain("WantedBy=default.target exact-host.service");
  });
});
