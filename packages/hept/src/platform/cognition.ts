import { NousClient } from '@nous-wave/client';
import type { CallContext } from '@nous-wave/contracts/common';
import type { ContextPrepareInput,ContextView } from '@nous-wave/contracts/cognition';
import type { MaterialView } from '@nous-wave/contracts/materials';
import type { CognitionConnection } from './models.js';
import type { management } from '../management/index.js';
import { problem } from './runtime.js';
export function cognitionConnection(managementApi:ReturnType<typeof management>):CognitionConnection {
 async function client(ctx:CallContext){const settings=(await managementApi.effective(ctx.subjectId)).effective;if(!settings.nous)problem('capability_unavailable','Nous cognition connection is not configured',503);return new NousClient({baseURL:settings.nous.baseURL,apiKey:await managementApi.secret(settings.nous.credentialRef)});}
 const options=(ctx:CallContext)=>({submissionId:ctx.traceContext.operationId,traceparent:ctx.traceContext.traceparent,purpose:ctx.purpose,audience:ctx.audience});
 return {
  available:async ctx=>Boolean((await managementApi.effective(ctx.subjectId)).effective.nous),
  prepare:async(ctx,input)=>(await client(ctx)).request<ContextView>('POST',`/v1/subjects/${ctx.subjectId}/context-views`,input,options(ctx)),
  capture:async(ctx,input)=>(await client(ctx)).request<MaterialView>('POST',`/v1/subjects/${ctx.subjectId}/materials`,input,options(ctx)),
  accept:async(ctx,input)=>(await client(ctx)).request('POST',`/v1/subjects/${ctx.subjectId}/encounters`,input,options(ctx)),
  growth:async(ctx,input)=>(await client(ctx)).request('POST',`/v1/subjects/${ctx.subjectId}/growth`,input,options(ctx))
 };
}
