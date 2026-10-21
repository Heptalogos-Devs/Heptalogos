import type {CallContext,Ref} from '@nous-wave/contracts/common';
import type {NetworkSelection} from '@nous-wave/platform/network';
import type {Kysely} from '@nous-wave/platform/storage';
import type {Database} from './database.js';
import type {ProductSettings} from './settings.js';
import {read,subjectIdOf,problem} from './runtime.js';
/** Reads current product resources; transport keeps no writable resource catalog. */
export function resourceNetwork(db:Kysely<Database>,config:ProductSettings,installationId:string,modelNetwork:(ctx:CallContext,ref:Ref)=>Promise<NetworkSelection>){
 return async(ctx:CallContext,ref:Ref):Promise<NetworkSelection>=>{
  if(ref.product!=='hept'||ref.installationId!==installationId||ref.selector)problem('forbidden','Network resource is outside this installation',403);
  if(ref.kind==='ModelResource')return modelNetwork(ctx,ref);
  if(ref.kind==='NativeRuntime'&&!ref.subjectId){
   const runtime=(await config.execution()).runtimes[ref.id];if(!runtime)problem('capability_unavailable','Native runtime connection is not configured',503);
   const url=new URL(runtime.endpoint);
   return {resource:{resourceRef:ref,operation:'native.connect',allowedOrigins:[url.origin],allowedPathPrefixes:[`${url.pathname.replace(/\/$/,'')}/plugins/hept/`],methods:['POST'],...runtime.network,credentialOrigins:[url.origin]}};
  }
  const sid=subjectIdOf(ctx);if(ref.subjectId!==sid)problem('forbidden','Network resource belongs to a different subject',403);
  if(ref.kind==='Channel'){
   const channel=await read(db,'channels',sid,ref.id),url=new URL(channel.endpoint as string);
   return {resource:{resourceRef:ref,operation:'channels.use',allowedOrigins:[url.origin],allowedPathPrefixes:[url.pathname],methods:['GET','POST'],...channel.network as any,credentialOrigins:[url.origin]}};
  }
  if(ref.kind==='subject'&&ref.id===sid){
   await read(db,'subjects',sid,sid);const connection=(await config.cognition(sid)).nous;
   if(!connection)problem('capability_unavailable','Nous cognition connection is not configured',503);
   const url=new URL(connection.baseURL);
   return {resource:{resourceRef:ref,operation:'cognition.invoke',allowedOrigins:[url.origin],allowedPathPrefixes:[`${url.pathname.replace(/\/$/,'')}/v1/subjects/${sid}`,`${url.pathname.replace(/\/$/,'')}/v1/identity`,`${url.pathname.replace(/\/$/,'')}/v1/delegations/`],methods:['POST','GET'],...connection.network,credentialOrigins:[url.origin]}};
  }
  problem('forbidden','Resource has no network capability',403);
 };
}
