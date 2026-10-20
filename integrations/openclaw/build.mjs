import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const output = path.join(root, 'data/native/plugins/hept-worker');
// tsx supplies the pinned esbuild already present in this workspace lockfile.
const tool = createRequire(import.meta.resolve('tsx'))('esbuild');
const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
const entries = ['index.ts', ...(pkg.exports?.['./client'] ? ['client.ts'] : [])];
await mkdir(output, { recursive: true });
await tool.build({ entryPoints: entries.map(file => path.join(directory, file)), outdir: output,
  bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: true,
  conditions: ['development'], legalComments: 'eof' });
const { configSchema } = await import(pathToFileURL(path.join(output, 'index.js')).href);
const { z } = createRequire(path.join(directory, 'package.json'))('zod');
const manifest = JSON.parse(await readFile(path.join(directory, 'openclaw.plugin.json'), 'utf8'));
manifest.configSchema = z.toJSONSchema(configSchema, { io: 'input' });
await writeFile(path.join(directory, 'openclaw.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, 'openclaw.plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(output, 'package.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version,
  type: 'module', license: pkg.license, exports: entries.length > 1 ? { '.': './index.js', './client': './client.js' } : './index.js',
  openclaw: { extensions: ['./index.js'] } }, null, 2)}\n`);
await copyFile(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
await copyFile(path.join(directory, 'README.md'), path.join(output, 'README.md'));
console.log(output);
