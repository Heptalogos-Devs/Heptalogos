// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Builds the installable plugin with the actual generated Client and only public SDK externals. */
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  entryPoints: [
    resolve(root, "src/index.ts"),
    resolve(root, "src/prepare-gateway.ts"),
    resolve(root, "src/dispatch.ts"),
    resolve(root, "src/gateway-read.ts"),
    resolve(root, "src/expression-send.ts"),
    resolve(root, "src/world-schedule.ts"),
    resolve(root, "src/world-wake-cli.ts"),
  ],
  outdir: resolve(root, "dist"),
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
const { nativePluginConfigSchema } = await import(
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
      contracts: { tools: ["heptalogos_life"] },
      configSchema: nativePluginConfigSchema,
    },
    null,
    2,
  ) + "\n",
);
