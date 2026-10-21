import type {CallContext} from '@nous-wave/contracts/common';
import type {Kysely} from '@nous-wave/platform/storage';
import {type Authorization,read,list,put} from '../platform/runtime.js';
import type {Database,Json} from '../platform/database.js';
export function management(db:Kysely<Database>,authorize:Authorization){return {
 async policy(ctx:CallContext,input?:Json){await authorize(ctx,input?'policy.write':'policy.read');const sid=ctx.subjectId;if(!sid)throw new Error('Subject required');const subject=await read(db,'subjects',sid,sid);if(!input)return subject.policy??{readers:['*'],purposes:['*'],audiences:['*']};return db.transaction().execute(tx=>put(tx,'subjects',sid,{...subject,policy:input},sid,subject.revision as number));},
};}
