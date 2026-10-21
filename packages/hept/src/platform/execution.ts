import {createOpenClawClient} from '@heptalogos/openclaw/client';
import type {CallContext,Ref} from '@nous-wave/contracts/common';
import type {SecretRegistry} from '@nous-wave/platform/credentials';
import type {Network} from '@nous-wave/platform/network';
import type {ProductSettings} from './settings.js';
import {problem} from './runtime.js';
export type NativeClient=ReturnType<typeof createOpenClawClient>;
/** The native bridge owns execution. Each use rechecks the current connection and secret. */
export interface ExecutionHost {
 withClient<T>(ctx:CallContext,runtimeId:string,use:(client:NativeClient)=>Promise<T>):Promise<T>;
}
export function executionHost(config:ProductSettings,secrets:SecretRegistry,network:Network,installationId:string):ExecutionHost {
 return {async withClient(ctx,runtimeId,use){
  const runtime=(await config.execution()).runtimes[runtimeId];if(!runtime)problem('capability_unavailable','Native runtime connection is not configured',503);
  const url=new URL(runtime.endpoint),resourceRef:Ref={product:'hept',installationId,kind:'NativeRuntime',id:runtimeId};
  return network.withClient(ctx,{resource:{resourceRef,operation:'native.connect',allowedOrigins:[url.origin],allowedPathPrefixes:[`${url.pathname.replace(/\/$/,'')}/plugins/hept/`],methods:['POST'],credentialOrigins:[url.origin],...runtime.network}},transport=>
   secrets.withSecret(ctx,{ref:runtime.credentialRef,purpose:'native.gateway',resourceRef},bytes=>
    use(createOpenClawClient({endpoint:runtime.endpoint,token:new TextDecoder().decode(bytes),fetch:transport.fetch}))));
 }};
}
