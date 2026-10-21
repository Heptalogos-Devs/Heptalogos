import {ProblemError} from '@nous-wave/platform/errors';
import {subjectIdOf} from '../platform/runtime.js';
import type { CallContext } from '@nous-wave/contracts/common';
import { subjectCreate } from '@heptalogos/contracts';
import type { Kysely } from 'kysely';
import { v7 } from 'uuid';
import type { Database } from '../platform/database.js';
import { type Authorization,read,list,put,idempotent } from '../platform/runtime.js';
export function identity(db:Kysely<Database>,authorize:Authorization){return {
 async create(ctx:CallContext,input:unknown){await authorize(ctx,'subjects.create');const parsed=subjectCreate.parse(input),sid=parsed.id??v7();return idempotent(db,`${ctx.actor.id}:subject:${parsed.clientSubmissionId}`,parsed,async tx=>put(tx,'subjects',sid,{displayName:parsed.displayName,roleMaterial:parsed.roleMaterial,capabilities:parsed.capabilities,runtime:'stopped'},sid),sid);},
 async list(ctx:CallContext){await authorize(ctx,'subjects.read');const rows=await db.selectFrom('subjects').selectAll().execute();const items=[];for(const row of rows){try{await authorize({...ctx,subjectId:row.id},'subjects.read');items.push({id:row.id,revision:row.revision,...row.document});}catch(error){if(!(error instanceof ProblemError&&error.problem.category==='forbidden'))throw error;}}return {items};},
 async read(ctx:CallContext){await authorize(ctx,'subjects.read');return read(db,'subjects',subjectIdOf(ctx),subjectIdOf(ctx));},
 async bind(ctx:CallContext,input:{installationId:string;subjectId:string;baseURL:string;credentialRef:string}){await authorize(ctx,'subjects.bind');if(input.subjectId!==subjectIdOf(ctx))throw new Error('Binding requires same logical SubjectId');const old=(await list(db,'subjectBindings',subjectIdOf(ctx))).find(x=>x.installationId===input.installationId);return old??db.transaction().execute(tx=>put(tx,'subjectBindings',subjectIdOf(ctx),input));},
 async changes(ctx:CallContext,after='0'){await authorize(ctx,'subjects.read');const rows=await db.selectFrom('subjectChanges').selectAll().where('subjectId','=',subjectIdOf(ctx)).where('cursor','>',after).orderBy('cursor').limit(100).execute();return {items:rows,nextCursor:rows.at(-1)?.cursor??after};}
};}
