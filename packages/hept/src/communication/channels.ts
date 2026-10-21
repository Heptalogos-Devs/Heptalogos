import type {Kysely} from 'kysely';
import type {CallContext,Ref} from '@nous-wave/contracts/common';
import type {DelegationScope,SecretRegistry,TargetScope} from '@nous-wave/platform/credentials';
import type {Network} from '@nous-wave/platform/network';
import {safeProblem} from '@nous-wave/platform/errors';
import {readReal} from '@nous-wave/platform/time';
import {channelConfiguration} from '@heptalogos/contracts';
import {sql} from 'kysely';
import {v7} from 'uuid';
import type {Database,Json} from '../platform/database.js';
import {type Authorization,read,list,put,problem,subjectIdOf} from '../platform/runtime.js';

const owns=(channel:Json,conversation:string)=>(channel.conversationKeys as string[]).some(key=>key==='*'||key===conversation);
export async function channelIngressTarget(db:Kysely<Database>,subjectId:string,accountId:string,conversationId:string):Promise<TargetScope>{
 if(accountId==='local')return {kind:'conversation',adapterId:'local',accountId,conversationId,actions:['messages.receive']};
 const row=await db.selectFrom('channels').selectAll().where('subjectId','=',subjectId).where('document','@>',{accountId}).forShare().executeTakeFirst(),channel=row?.document;
 if(!channel?.receive||!owns(channel,conversationId)||(channel.connection as Json|undefined)?.state!=='connected')problem('forbidden','Channel receiving is disabled for this account or conversation',403);
 return {kind:'conversation',adapterId:channel.adapterId as string,accountId,conversationId,actions:['messages.receive']};
}
/** A channel service remains bounded by the current connected account and exact conversation targets. */
export async function channelIngressScope(db:Kysely<Database>,scope:DelegationScope):Promise<boolean>{
 if(scope.plane!=='system'||scope.subjectIds.length!==1||!scope.expiresAt||scope.mayDelegate||scope.inputRefs.length||scope.taskRef||scope.nativeBinding||scope.purposes.length!==1||scope.purposes[0]!=='ingress'||scope.audiences.length!==1||scope.audiences[0]!==scope.subjectIds[0]||scope.operations.some(op=>op!=='messages.receive')||scope.targets.length===0)return false;
 for(const target of scope.targets){
  if(target.kind!=='conversation'||target.conversationId==='*'||target.accountId==='local'||target.actions.some(action=>action!=='messages.receive'))return false;
  const channel=(await list(db,'channels',scope.subjectIds[0]!)).find(value=>value.adapterId===target.adapterId&&value.accountId===target.accountId);
  if(!channel?.receive||!owns(channel,target.conversationId)||(channel.connection as Json|undefined)?.state!=='connected')return false;
 }
 return true;
}
export function createChannels(db:Kysely<Database>,installationId:string,secrets:SecretRegistry,network:Network,authorize:Authorization,beforeDispatch:()=>void){
 const ref=(subjectId:string,id:string):Ref=>({product:'hept',installationId,subjectId,kind:'Channel',id});
 async function request(ctx:CallContext,channel:Json,path:string,body?:unknown){
  if(!channel.endpoint||!channel.credentialRef)problem('capability_unavailable','Channel connection is incomplete',409);
  const endpoint=new URL(channel.endpoint as string),resourceRef=ref(subjectIdOf(ctx),channel.id as string);
  return network.withClient(ctx,{resource:{resourceRef,operation:'channels.use',allowedOrigins:[endpoint.origin],allowedPathPrefixes:[endpoint.pathname],methods:['GET','POST'],credentialOrigins:[endpoint.origin],...channel.network as {profileId:string;addressScope:'public'|'configured_private';allowedPrivateRanges:string[]}}},transport=>secrets.withSecret(ctx,{ref:channel.credentialRef as string,purpose:'channel.control',resourceRef},async bytes=>{
   const current=await read(db,'channels',subjectIdOf(ctx),channel.id as string);if(current.revision!==channel.revision)problem('conflict','Channel changed before the native request',409);await authorize(ctx,'channels.use',resourceRef);beforeDispatch();const response=await transport.fetch(`${String(channel.endpoint).replace(/\/$/,'')}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${new TextDecoder().decode(bytes)}`,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   if(!response.ok)problem('dependency_unavailable',`Channel HTTP ${response.status}`,503);return response.json() as Promise<Json>;
  }));
 }
 async function connect(ctx:CallContext,id:string){
  const subjectId=subjectIdOf(ctx),channel=await read(db,'channels',subjectId,id);await authorize(ctx,'channels.write',ref(subjectId,id));
  if(channel.host==='local')problem('invalid_input','Local communication does not need an external channel connection');
  const accounts=await request(ctx,channel,'/v1/accounts'),capabilities=await request(ctx,channel,'/v1/capabilities');
  const account=(accounts.accounts as Json[]).find(value=>value.adapterId===channel.adapterId&&value.accountId===channel.accountId&&value.subjectId===subjectId);
  if(!account)problem('forbidden','Actual channel account does not match the configured adapter and Subject',403);
  const connected=await put(db,'channels',subjectId,{...channel,capabilities,connection:{state:'connected',connectedAt:readReal()}},id,channel.revision as number);
  if(!connected.receive)return connected;
  const known=(await list(db,'conversations',subjectId)).filter(value=>value.channelAccount===connected.accountId).map(value=>value.key as string),keys=[...new Set([...(connected.conversationKeys as string[]),...known,...(account.conversations as string[]??[])])].filter(key=>key!=='*'),coverage=[];
  for(const key of keys){try{const result=await request(ctx,connected,'/v1/history',{channelAccount:connected.accountId,conversationKey:key,count:50});coverage.push({conversationKey:key,...result.range as Json,checkedAt:readReal()});}catch(error){coverage.push({conversationKey:key,complete:false,reason:safeProblem(error).code,checkedAt:readReal()});}}
  const current=await read(db,'channels',subjectId,id);if(current.revision!==connected.revision)problem('conflict','Channel configuration changed during history synchronization',409);
  return put(db,'channels',subjectId,{...current,historyCoverage:coverage},id,current.revision as number);
 }
 return {
  request,connect,
  async configure(ctx:CallContext,input:unknown){
   const {id:requestedId,expectedRevision,...configuration}=channelConfiguration.parse(input),subjectId=subjectIdOf(ctx),id=requestedId??v7();await authorize(ctx,'channels.write',ref(subjectId,id));
   if(expectedRevision>0&&!requestedId)problem('invalid_input','Updating a channel requires its actual id');
   if(configuration.host==='local')problem('invalid_input','Local communication has no external channel configuration');
   return db.transaction().execute(async tx=>{await sql`select pg_advisory_xact_lock(hashtextextended(${`${subjectId}:channel:${configuration.accountId}`},0))`.execute(tx);const existing=(await list(tx,'channels',subjectId)).find(value=>value.accountId===configuration.accountId);if(existing&&existing.id!==id)problem('conflict','This channel account already has a configuration',409);if(expectedRevision===0){if(requestedId&&await tx.selectFrom('channels').select('id').where('id','=',id).executeTakeFirst())problem('conflict','Channel already exists',409);return put(tx,'channels',subjectId,{...configuration,connection:{state:'configured'}},id);}await read(tx,'channels',subjectId,id);await authorize(ctx,'channels.write',ref(subjectId,id),tx);return put(tx,'channels',subjectId,{...configuration,connection:{state:'configured'}},id,expectedRevision);});
  },
  async list(ctx:CallContext){await authorize(ctx,'channels.read');return {items:await list(db,'channels',subjectIdOf(ctx))};},
 };
}
