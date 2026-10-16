// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Builds the installable plugin with the actual generated Client and only public SDK externals. */
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(root, "dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  metafile: true,
  external: ["openclaw/*", "ws", "ajv", "ajv/*", "typebox", "typebox/*"],
});
for (const output of Object.values(result.metafile.outputs)) {
  for (const [input, contribution] of Object.entries(output.inputs)) {
    if (
      contribution.bytesInOutput > 0 &&
      /packages\/(data|bootstrap|system|product\/(subject|identity))\//u.test(input)
    )
      throw Error("Plugin bundle retained a Host-only module: " + input);
  }
  for (const item of output.imports)
    if (
      item.external &&
      !/^(node:|openclaw\/plugin-sdk\/|ws$|ajv(?:\/|$)|typebox(?:\/|$))/u.test(
        item.path,
      )
    )
      throw Error(
        "Plugin bundle retained an undeclared runtime dependency: " + item.path,
      );
}
await writeFile(
  resolve(root, "dist/bundle.meta.json"),
  JSON.stringify(result.metafile, null, 2) + "\n",
);
const { qqPluginConfigSchema } = await import(
  new URL("../dist/config.js", import.meta.url)
);
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await writeFile(
  resolve(root, "openclaw.plugin.json"),
  JSON.stringify(
    {
      id: "heptalogos-qq",
      name: "Heptalogos QQ",
      description: "Host-governed first-party QQ channel",
      version: pkg.version,
      channels: ["heptalogos-qq"],
      configSchema: qqPluginConfigSchema,
    },
    null,
    2,
  ) + "\n",
);
