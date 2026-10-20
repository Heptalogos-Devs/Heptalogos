import type { CallContext } from '@nous-wave/contracts/common';
import { subjectCreate } from '@heptalogos/contracts';
import type { Kysely } from 'kysely';
import { v7 } from 'uuid';
import type { Database } from '../platform/database.js';
import { authorize,read,list,put,idempotent } from '../platform/runtime.js';
export function identity(db:Kysely<Database>){return {
 async create(ctx:CallContext,input:unknown){authorize(ctx,'subjects.create');const parsed=subjectCreate.parse(input),sid=parsed.id??v7();return idempotent(db,`${ctx.actor.id}:subject:${parsed.clientSubmissionId}`,parsed,async tx=>put(tx,'subjects',sid,{displayName:parsed.displayName,roleMaterial:parsed.roleMaterial,capabilities:parsed.capabilities,runtime:'stopped'},sid),sid);},
 async list(ctx:CallContext){authorize(ctx,'subjects.read');const rows=await db.selectFrom('subjects').selectAll().execute();return {items:rows.filter(r=>!ctx.actor.subjectIds||ctx.actor.subjectIds.includes('*')||ctx.actor.subjectIds.includes(r.id)).map(r=>({id:r.id,revision:r.revision,...r.document}))};},
 async read(ctx:CallContext){authorize(ctx,'subjects.read');return read(db,'subjects',ctx.subjectId,ctx.subjectId);},
 async runtime(ctx:CallContext,action:'start'|'pause'|'stop'){authorize(ctx,'subjects.control');const old=await read(db,'subjects',ctx.subjectId,ctx.subjectId);return db.transaction().execute(tx=>put(tx,'subjects',ctx.subjectId,{...old,runtime:action==='start'?'running':action==='pause'?'paused':'stopped'},ctx.subjectId,old.revision as number));},
 async bind(ctx:CallContext,input:{installationId:string;subjectId:string;baseURL:string;credentialRef:string}){authorize(ctx,'subjects.bind');if(input.subjectId!==ctx.subjectId)throw new Error('Binding requires same logical SubjectId');const old=(await list(db,'subjectBindings',ctx.subjectId)).find(x=>x.installationId===input.installationId);return old??db.transaction().execute(tx=>put(tx,'subjectBindings',ctx.subjectId,input));},
 async changes(ctx:CallContext,after='0'){authorize(ctx,'subjects.read');const rows=await db.selectFrom('subjectChanges').selectAll().where('subjectId','=',ctx.subjectId).where('cursor','>',after).orderBy('cursor').limit(100).execute();return {items:rows,nextCursor:rows.at(-1)?.cursor??after};}
};}
