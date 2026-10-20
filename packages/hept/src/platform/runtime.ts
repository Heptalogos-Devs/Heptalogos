import {operationTrace} from './telemetry.js';
import { createHash,randomBytes } from 'node:crypto';
import { v7 } from 'uuid';
import type { CallContext, Ref } from '@nous-wave/contracts/common';
import { sql,type Kysely } from 'kysely';
import type { Database,Table,Json } from './database.js';
export const now=()=>new Date().toISOString();
export const realTime=()=>({clockId:'real',at:now()});
export function problem(code:string,detail:string,status=400):never{throw Object.assign(new Error(detail),{code,status});}
export function authorize(ctx:CallContext,grant:string){
 if(ctx.actor.expiresAt&&Date.parse(ctx.actor.expiresAt)<Date.now())problem('forbidden','Authorization expired',403);
 if(ctx.actor.subjectIds&&!ctx.actor.subjectIds.includes('*')&&!ctx.actor.subjectIds.includes(ctx.subjectId))problem('forbidden','Subject outside authorization',403);
 if(!ctx.actor.grants.some((g:string)=>g==='*'||g===grant||g===grant.split('.')[0]+'.*'))problem('forbidden',`Requires ${grant}`,403);
}
export function callContext(subjectId:string,actor:CallContext['actor'],purpose='management',audience:string[]=[]):CallContext{return {actor,subjectId,purpose,audience,traceContext:{...operationTrace(),operationId:v7()}};}
export function makeRef(installationId:string,subjectId:string,kind:string,id:string,revision=1):Ref{return {product:'hept',installationId,subjectId,kind,id,revision};}
export function digest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
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
