#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from original Hept CLI bin.ts: one safe error/output boundary.
import {CommanderError} from 'commander';
import {ProblemError,safeProblem} from '@nous-wave/platform/errors';
import {createCli} from './index.js';
const cli=createCli().exitOverride().configureOutput({outputError:()=>undefined});
try{await cli.parseAsync();}
catch(error){
 if(error instanceof CommanderError&&error.exitCode===0)process.exitCode=0;
 else{
  const value=error instanceof CommanderError?{code:'cli.invalid_input',category:'validation' as const,status:400,messageKey:'cli.invalid_input',message:'命令参数无效，请查看 --help'}:safeProblem(error,'cli.failed');
  process.stderr.write(`${JSON.stringify(value)}\n`);
  process.exitCode=value.code==='cli.cancelled'?130:value.category==='validation'?2:value.category==='forbidden'?3:['unavailable','resource_pressure'].includes(value.category)?4:value.category==='effect_unknown'?5:1;
 }
}
