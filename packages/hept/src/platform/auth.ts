import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { getMigrations } from 'better-auth/db/migration';
import type { Pool } from 'pg';
import { ActorSchema,type Actor } from '@nous-wave/contracts/common';
import { problem } from './runtime.js';
export interface Authentication {auth:{handler(request:Request):Promise<Response>};actor(headers:Headers):Promise<Actor>;bootstrap(input:{email:string;password:string;name:string}):Promise<{userId:string}>;createKey(userId:string,actor:Actor,name:string):Promise<{id:string;key:string}>}
export async function createAuthentication(pool:Pool,secret:string,baseURL:string):Promise<Authentication>{
 const options={database:pool,secret,baseURL,advanced:{cookiePrefix:'heptalogos'},emailAndPassword:{enabled:true},plugins:[admin(),apiKey({enableMetadata:true})]};
 await(await getMigrations(options)).runMigrations();const auth=betterAuth(options);
 return {auth:{handler:request=>auth.handler(request)},
  async actor(headers:Headers):Promise<Actor>{const key=headers.get('authorization')?.replace(/^Bearer\s+/i,'')??headers.get('x-api-key');if(key){const verification=await auth.api.verifyApiKey({body:{key}});if(!verification.valid||!verification.key)problem('forbidden','Invalid API key',401);const authContext=await auth.$context;const owner=await authContext.internalAdapter.findUserById(verification.key.referenceId);if(!owner)problem('forbidden','API key owner no longer exists',401);if((owner as {role?:string}).role!=='admin')return {kind:'human',id:owner.id,grants:['subjects.read','messages.read'],subjectIds:[]};const delegated={...verification.key.metadata?.actor};if(delegated.expiresAt instanceof Date)delegated.expiresAt=delegated.expiresAt.toISOString();return ActorSchema.parse(delegated);}const session=await auth.api.getSession({headers});if(!session)problem('forbidden','Login required',401);return {kind:'human',id:session.user.id,grants:(session.user as {role?:string}).role==='admin'?['*']:['subjects.read','messages.read'],subjectIds:(session.user as {role?:string}).role==='admin'?undefined:[]};},
  async bootstrap(input:{email:string;password:string;name:string}){const ctx=await auth.$context;const existing=await ctx.internalAdapter.findUserByEmail(input.email);if(existing)problem('conflict','Administrator already exists',409);const created=await auth.api.signUpEmail({body:input});await ctx.internalAdapter.updateUser(created.user.id,{role:'admin'});return {userId:created.user.id};},
  async createKey(userId:string,actor:Actor,name:string){const result=await auth.api.createApiKey({body:{userId,name,metadata:{actor},permissions:{operations:actor.grants},rateLimitEnabled:true,rateLimitMax:600,rateLimitTimeWindow:60000}});return {id:result.id,key:result.key};}
 };
}
