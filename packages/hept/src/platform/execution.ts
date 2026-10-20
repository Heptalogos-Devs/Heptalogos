import { createOpenClawClient,type NativeProgress } from '../../../../integrations/openclaw/client.js';
import type { ExecutionHost } from '../work/index.js';
export function executionHost(options:{endpoint:string;credentialRef:string},secret:(ref:string)=>Promise<string>):ExecutionHost {
 async function client(){return createOpenClawClient({endpoint:options.endpoint,token:await secret(options.credentialRef)});}
 function progress(native:NativeProgress){return {runId:native.runId,sessionId:native.sessionKey,status:native.status,progress:typeof native.progress==='string'?native.progress:JSON.stringify(native.progress),...(native.result?{result:{conclusion:native.result.text,outputRef:native.result.outputRef,outputRefs:native.result.outputRefs,artifacts:[],sourceRefs:[],unresolved:[]}}:{})};}
 return {
 async start(taskId,request,ctx){const native=await(await client()).start({taskId,subjectId:ctx.subjectId,goal:request.goal,allowedTools:request.allowedTools,inputRefs:request.inputRefs,workspaceRef:request.workspaceRef,budget:request.budget,returnTarget:request.returnTarget,traceparent:ctx.traceContext.traceparent});return {runId:native.runId,sessionId:native.sessionKey};},
 async inspect(runId,sessionId){if(!sessionId)throw new Error('Native task has no saved session identity');return progress(await(await client()).inspect({runId,sessionKey:sessionId}));},
 async locate(taskId,subjectId){return progress(await(await client()).locate({taskId,subjectId}));},
 async transcript(runId,sessionId,options){return(await client()).transcript({runId,sessionKey:sessionId,...options});},
 async purge(runId,sessionId){return(await client()).purge({runId,sessionKey:sessionId});},
 async cancel(runId,sessionId){if(!sessionId)throw new Error('Native task has no saved session identity');return(await client()).cancel({runId,sessionKey:sessionId});}
 };
}
