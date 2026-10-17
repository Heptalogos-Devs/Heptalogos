// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createArchiveStore } from "../../src/archive-store.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("archives exact lossless protocol JSON atomically and rejects altered or foreign references", async () => {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-private-archive-"));
  roots.push(root);
  const archive = createArchiveStore(root, 4096);
  const value = {
    id: "900719925474099399999",
    message: [{ type: "text", data: { text: "[CQ:image,file=not-a-real-image]" } }],
  };
  const copies = await Promise.all(
    Array.from({ length: 8 }, () =>
      archive.archiveEnvelope({ kind: "envelope", value }),
    ),
  );
  expect(new Set(copies.map((v) => v.reference)).size).toBe(1);
  expect((await archive.readArchive(copies[0]!)).value).toEqual(value);
  const path = join(root, copies[0]!.reference.split(":")[2]!);
  expect(await readFile(path, "utf8")).toContain(value.id);
  await expect(
    archive.readArchive({ reference: "archive:sha256:../../secret" }),
  ).rejects.toThrow("Unknown protected");
  await expect(
    archive.uploadAttachment(new Uint8Array(4097), "image/png"),
  ).rejects.toThrow("size limit");
  await writeFile(path, "{}");
  await expect(archive.readArchive(copies[0]!)).rejects.toThrow("integrity");
});

it("flushes streamed media before publishing its exact content address and removes rejected uploads", async () => {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-streamed-archive-"));
  roots.push(root);
  const archive = createArchiveStore(root, 8);
  const bytes = Buffer.from([0, 1, 2, 255, 128, 10]);
  const uploaded = await archive.uploadAttachmentStream(
    Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]),
    "application/octet-stream",
  );
  expect(uploaded.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(uploaded.bytes).toBe(bytes.length);
  expect(await archive.readAttachment(uploaded)).toEqual(bytes);
  await expect(
    archive.uploadAttachmentStream(
      Readable.from([Buffer.alloc(4), Buffer.alloc(5)]),
      "application/octet-stream",
    ),
  ).rejects.toThrow("size limit");
  expect(await readdir(root)).toEqual([uploaded.sha256]);
});
