// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const boundarySource = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify/boundaries.mjs", import.meta.url)),
  "utf8",
);
const eslintSource = readFileSync(
  fileURLToPath(new URL("../../../eslint.config.mjs", import.meta.url)),
  "utf8",
);
const oxlintSource = readFileSync(
  fileURLToPath(new URL("../../../.oxlintrc.json", import.meta.url)),
  "utf8",
);
const schemaOwnerOxlintSource = readFileSync(
  fileURLToPath(new URL("../../../.oxlintrc-schema-owner.json", import.meta.url)),
  "utf8",
);
const dependencySource = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify/dependencies.mjs", import.meta.url)),
  "utf8",
);

describe("repository boundary ownership", () => {
  it("delegates generic import restrictions to Oxlint and Nx ESLint", () => {
    expect(boundarySource).not.toMatch(
      /restrictedImports|restrictedSpecifiers|isRestrictedImportAllowed|isRestrictedSpecifierAllowed|isCrossWorkspaceRelativeImport|isAreaDependencyAllowed/u,
    );
    expect(eslintSource).not.toContain("no-restricted-imports");
    expect(oxlintSource).toContain("no-restricted-imports");
    expect(oxlintSource).toContain('"@heptalogos/repo-kit"');
    expect(oxlintSource).toContain("@heptalogos/persistence/repository");
    expect(schemaOwnerOxlintSource).toContain('"ajv"');
    expect(schemaOwnerOxlintSource).toContain('"typebox"');
    expect(eslintSource).toContain("@nx/enforce-module-boundaries");
  });

  it("keeps Heptalogos-specific public and Authority checks in the custom gate", () => {
    expect(boundarySource).toContain("raw bootstrap/recovery Authority primitive");
    expect(boundarySource).toContain("HostOwnershipToken creation is outside");
    expect(boundarySource).not.toContain(
      "repository tooling import must not enter source",
    );
    expect(dependencySource).toContain("packageRoutes");
    expect(dependencySource).toContain("dependency route is not adopted for use");
  });

  it("encodes the WorkQueue runtime seam as a narrow Nx source tag", () => {
    expect(eslintSource).toContain('sourceTag: "area:work-queue"');
    expect(eslintSource).toContain('"area:runtime"');
    expect(eslintSource).toContain('"area:service"');
  });
});
