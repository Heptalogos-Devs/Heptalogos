// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Protected immutable raw and media storage, independent of model-readable materials.
 * @module archive-store
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { writeFileAtomic } from "./atomic-file.js";
import {
  canonicalizeJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
/** Creates a private, content-addressed archive with bounded reads and writes. */
export function createArchiveStore(root: string, maxBytes = 64 * 1024 * 1024) {
  const digest = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const put = async (bytes: Uint8Array) => {
    if (bytes.byteLength > maxBytes)
      throw new Error("Protected archive size limit exceeded");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const hash = digest(bytes);
    const path = join(root, hash);
    try {
      const stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.size !== bytes.byteLength ||
        digest(await readFile(path)) !== hash
      )
        throw new Error("Protected archive integrity check failed");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        throw error;
      await writeFileAtomic(path, bytes, { mode: 0o600, fsync: true });
    }
    return hash;
  };
  return {
    async readAttachment(input: { reference: string; sha256: string; bytes: number }) {
      const matched = /^cas:sha256:([a-f0-9]{64})$/.exec(input.reference);
      if (!matched || matched[1] !== input.sha256)
        throw new Error("Unknown protected media reference");
      const path = join(root, input.sha256);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > maxBytes || stat.size !== input.bytes)
        throw new Error("Protected media is unavailable");
      const bytes = await readFile(path);
      if (digest(bytes) !== input.sha256)
        throw new Error("Protected media integrity check failed");
      return bytes;
    },
    async uploadAttachmentStream(source: Readable, mediaType: string) {
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mediaType))
        throw new Error("Invalid declared media type");
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temporary = join(root, ".upload-" + randomUUID());
      const hasher = createHash("sha256");
      let bytes = 0;
      const bound = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            done(new Error("Protected media size limit exceeded"));
            return;
          }
          hasher.update(chunk);
          done(null, chunk);
        },
      });
      try {
        await pipeline(
          source,
          bound,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        );
        const file = await open(temporary, "r");
        try {
          await file.sync();
        } finally {
          await file.close();
        }
        const sha256 = hasher.digest("hex");
        await rename(temporary, join(root, sha256));
        return { reference: "cas:sha256:" + sha256, sha256, bytes, mediaType };
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
    async archiveEnvelope(input: { kind: "envelope" | "segment"; value: unknown }) {
      const bytes = Buffer.from(canonicalizeJson(input.value as CanonicalJsonValue));
      return { reference: "archive:sha256:" + (await put(bytes)) };
    },
    async readArchive(input: { reference: string }) {
      const matched = /^archive:sha256:([a-f0-9]{64})$/.exec(input.reference);
      if (!matched) throw new Error("Unknown protected archive reference");
      const path = join(root, matched[1]!);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > maxBytes)
        throw new Error("Protected archive is unavailable");
      const bytes = await readFile(path);
      if (digest(bytes) !== matched[1])
        throw new Error("Protected archive integrity check failed");
      return { value: JSON.parse(bytes.toString("utf8")) as unknown };
    },
    async uploadAttachment(bytes: Uint8Array, mediaType: string) {
      const sha256 = await put(bytes);
      return {
        reference: "cas:sha256:" + sha256,
        sha256,
        bytes: bytes.byteLength,
        mediaType,
      };
    },
  };
}
