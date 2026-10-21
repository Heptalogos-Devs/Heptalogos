import {canonicalize} from 'json-canonicalize';
import {readReal} from '@nous-wave/platform/time';
import { createHash,randomBytes } from 'node:crypto';
import { v7 } from 'uuid';
import { ProblemError,type Problem,type CallContext,type Ref } from '@nous-wave/contracts/common';
import { sql,type Kysely } from 'kysely';
import type { Database,Table,Json } from './database.js';
export const now=()=>readReal().at;
export function operationTrace(){const traceId=randomBytes(16).toString('hex'),spanId=randomBytes(8).toString('hex');return {traceId,traceparent:`00-${traceId}-${spanId}-01`};}
export function problem(code:string,message:string,status=400):never {
 const category:Problem['category']=code==='effect_unknown'?'effect_unknown':code==='budget_exhausted'?'budget':status===401||status===403?'forbidden':status===404?'not_found':status===409?'conflict':status>=500?'unavailable':'validation';
 throw new ProblemError({code:`hept.${code}`,category,status,messageKey:`hept.${code}`,message});
}
export type Authorization=(ctx:CallContext,operation:string,target?:Ref|import('@nous-wave/platform/credentials').TargetScope,client?:Kysely<Database>)=>Promise<void>;
export function callContext(input:{actor:CallContext['actor'];consumer:CallContext['consumer'];subjectId?:string;purpose?:string;audience?:string[]}):CallContext{return {...input,purpose:input.purpose??'management',audience:input.audience??[],trace:{...operationTrace(),operationId:v7()}};}
export function subjectIdOf(ctx:CallContext):string{if(!ctx.subjectId)problem('invalid_input','This operation requires a subject');return ctx.subjectId;}
export function makeRef(installationId:string,subjectId:string,kind:string,id:string,revision=1):Ref{return {product:'hept',installationId,subjectId,kind,id,revision};}
export function digest(value:unknown){return createHash('sha256').update(canonicalize(value)).digest('hex');}
export async function read<T=Json>(db:Kysely<Database>,table:Table,subjectId:string,id:string):Promise<T>{const row=await db.selectFrom(table).selectAll().where('subjectId','=',subjectId).where('id','=',id).executeTakeFirst();if(!row)problem('not_found',`${table} ${id} not found`,404);return {...row.document,id:row.id,revision:row.revision,createdAt:row.createdAt,updatedAt:row.updatedAt} as T;}
export async function list<T=Json>(db:Kysely<Database>,table:Table,subjectId:string){return (await db.selectFrom(table).selectAll().where('subjectId','=',subjectId).orderBy('createdAt','asc').execute()).map(row=>({...row.document,id:row.id,revision:row.revision,createdAt:row.createdAt,updatedAt:row.updatedAt})) as T[];}
export async function put(db:Kysely<Database>,table:Table,subjectId:string,document:Json,id=v7(),expectedRevision?:number):Promise<Json & {id:string;revision:number}>{
 const stored={...document};for(const field of ['id','revision','createdAt','updatedAt'])delete stored[field];
 if(expectedRevision!==undefined){const row=await db.updateTable(table).set({document:stored,revision:expectedRevision+1,updatedAt:now()}).where('subjectId','=',subjectId).where('id','=',id).where('revision','=',expectedRevision).returningAll().executeTakeFirst();if(!row)problem('conflict','Object changed; read current revision',409);}
 else await db.insertInto(table).values({id,subjectId,revision:1,document:stored,createdAt:now(),updatedAt:now()}).execute();
 await db.insertInto('subjectChanges').values({subjectId,changedRefs:{table,id,revision:expectedRevision===undefined?1:expectedRevision+1},recordedAt:now()}).execute();
 return {...stored,id,revision:expectedRevision===undefined?1:expectedRevision+1};
}
export async function idempotent<T>(db:Kysely<Database>,key:string,input:unknown,work:(tx:Kysely<Database>)=>Promise<T>,subjectId='installation'):Promise<T>{return db.transaction().execute(async tx=>{
 await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(tx);
 const existing=await tx.selectFrom('requestKeys').selectAll().where('key','=',key).executeTakeFirst();
 const hash=digest(input);if(existing){if(existing.digest!==hash)problem('conflict','Submission identity has different input',409);return existing.result as T;}
 const result=await work(tx);await tx.insertInto('requestKeys').values({key,subjectId,digest:hash,result}).execute();return result;
});}
