#!/usr/bin/env node
import { Command } from 'commander';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeProblem } from '@nous-wave/platform/errors';
import { runHost } from './main.js';
const cli=new Command().name('hept-host').option('--config <file>').option('--instance-home <directory>');
cli.parse();
try{
 await runHost({programRoot:dirname(fileURLToPath(import.meta.resolve('@heptalogos/hept/package.json'))),configPath:cli.opts().config,instanceHome:cli.opts().instanceHome,
  onStarted:status=>process.stdout.write(`${JSON.stringify(status)}\n`)});
}catch(error){process.stderr.write(`${JSON.stringify(safeProblem(error,'hept.host_failed'))}\n`);process.exitCode=1;}
