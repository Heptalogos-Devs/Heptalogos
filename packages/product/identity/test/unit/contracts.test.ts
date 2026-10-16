// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  resolveAccountInputSchema,
  bindSubjectAccountInputSchema,
} from "../../src/contracts.js";
it("requires authenticated string identity keys and refuses nickname linkage inputs", () => {
  const resolve = compileSchema(resolveAccountInputSchema);
  expect(
    resolve.validate({
      platform: "qq",
      accountId: "9007199254740993888",
      uid: "u_formal",
    }).ok,
  ).toBe(true);
  expect(resolve.validate({ platform: "qq", accountId: 9007199254740994 }).ok).toBe(
    false,
  );
  expect(
    resolve.validate({ platform: "qq", accountId: "10001", nickname: "same nickname" })
      .ok,
  ).toBe(false);
  const bind = compileSchema(bindSubjectAccountInputSchema);
  expect(
    bind.validate({
      platform: "qq",
      accountId: "10001",
      subjectId: "existing-nous-subject",
    }).ok,
  ).toBe(true);
});
