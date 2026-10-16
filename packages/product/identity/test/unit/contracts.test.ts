// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  resolveAccountInputSchema,
  bindSubjectAccountInputSchema,
  entitySchema,
  linkAccountInputSchema,
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

it("shares the canonical opaque EntityRef schema for results and explicit account linkage", () => {
  const entityRef = "entity:heptalogos:01a141ed-ed13-739d-ab38-8619b78d9259";
  const output = compileSchema(entitySchema);
  const input = compileSchema(linkAccountInputSchema);
  expect(output.validate({ entityRef, kind: "person" }).ok).toBe(true);
  expect(input.validate({ entityRef, platform: "qq", accountId: "10001" }).ok).toBe(
    true,
  );
  for (const invalid of [
    entityRef.split(":")[2],
    "entity:heptalogos:" + entityRef,
    "entity:other:" + entityRef.split(":")[2],
    entityRef + " ",
  ]) {
    expect(output.validate({ entityRef: invalid, kind: "person" }).ok).toBe(false);
    expect(
      input.validate({ entityRef: invalid, platform: "qq", accountId: "10001" }).ok,
    ).toBe(false);
  }
});
