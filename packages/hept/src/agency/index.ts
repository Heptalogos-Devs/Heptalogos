import {subjectIdOf} from '../platform/runtime.js';
import {parse as parseTimePoint} from '@nous-wave/platform/time';
import {readReal} from '@nous-wave/platform/time';
import {RefSchema,type CallContext,type TimePoint,type TimeRange} from '@nous-wave/contracts/common';
import { decision,decisionDraft,expressionDraft,pursuitInput,type Decision } from '@heptalogos/contracts';
import type { Kysely } from 'kysely';
import { v7 } from 'uuid';
import type { Database,Json } from '../platform/database.js';
import { type Authorization,read,list,put,problem,makeRef } from '../platform/runtime.js';
import { readableParts,type communication } from '../communication/index.js';
import type { world } from '../world/index.js';
import type { models,CognitionConnection } from '../platform/models.js';
import type { ProductSettings } from '../platform/settings.js';
import type { management } from '../management/index.js';
import {permits} from '../communication/media.js';
import type {Policy} from '@nous-wave/contracts/common';
import { rankOpportunities } from './attention.js';
export function agency(db:Kysely<Database>,transaction:<T>(name:string,use:(tx:Kysely<Database>)=>Promise<T>)=>Promise<T>,installationId:string,worldApi:ReturnType<typeof world>,communicationApi:ReturnType<typeof communication>,modelApi:ReturnType<typeof models>,config:ProductSettings,authorize:Authorization,cognition:CognitionConnection){
 async function prepare(ctx:CallContext,trigger:string='manual'):Promise<{subject:Json;situation:Awaited<ReturnType<typeof worldApi.situation>>;opportunities:Json[];materials:{ref:ReturnType<typeof makeRef>;text:string;policy?:Policy;occurred?:TimeRange}[];deferred:boolean;trigger?:string}>{await authorize(ctx,'agency.react');const subject=await read(db,'subjects',subjectIdOf(ctx),subjectIdOf(ctx));if(subject.runtime!=='running')problem('capability_unavailable','Subject is paused or stopped',409);const situation=await worldApi.situation(subjectIdOf(ctx));const {communication,attention}=await config.agency(subjectIdOf(ctx));const conversations=await list(db,'conversations',subjectIdOf(ctx)),channels=await list(db,'channels',subjectIdOf(ctx));const allowed=new Set(conversations.filter(c=>communication.behavior.allowedConversations.some(key=>key==='*'||key===c.key)&&(c.channelAccount==='local'||channels.some(channel=>channel.accountId===c.channelAccount&&channel.participate&&(channel.conversationKeys as string[]).some(key=>key==='*'||key===c.key)))).map(c=>c.id));const opportunities=rankOpportunities((await list(db,'opportunities',subjectIdOf(ctx))).filter(o=>o.state!=='decided'&&(!o.conversationId||allowed.has(o.conversationId))));const pending=(await list(db,'messages',subjectIdOf(ctx))).filter(m=>m.direction==='inbound'&&opportunities.some(o=>(o.originRef as Json).id===m.id));const life=situation.activity as Json|null;
  if(life?.interruptibility==='closed'&&!opportunities.some(o=>(o.notice as Json)?.urgent)){return {subject,situation,opportunities:[],materials:[],deferred:true};}
  if(trigger==='notification'&&!opportunities.length)return {subject,situation,opportunities:[],materials:[],deferred:true};
  if(trigger==='natural'){const today=new Date();today.setUTCHours(0,0,0,0);const automatic=(await list(db,'decisions',subjectIdOf(ctx))).filter(d=>d.trigger==='natural'&&new Date(String(d.createdAt))>=today).length;if(automatic>=attention.dailyAutonomousCalls)return {subject,situation,opportunities:[],materials:[],deferred:true};}
  if(!communication.behavior.participate)return {subject,situation,opportunities:[],materials:[],deferred:true};
  const materials: {ref:ReturnType<typeof makeRef>;text:string}[]=[];const readable=pending.map(m=>({ref:makeRef(installationId,subjectIdOf(ctx),'message',m.id as string,m.revision as number),text:`${m.authorName??m.authorId}: ${readableParts(m.parts as any)}`}));return {subject,situation,opportunities,materials,deferred:false,trigger};
 }
 async function choose(ctx:CallContext,prepared:Awaited<ReturnType<typeof prepare>>,invocationId:string){
  const conversations=await list(db,'conversations',subjectIdOf(ctx));const commitments=(await list(db,'commitments',subjectIdOf(ctx))).filter(c=>['active','communication_unknown'].includes(c.status as string));const pursuits=(await list(db,'pursuits',subjectIdOf(ctx))).filter(p=>p.status==='active');
  const proposal=await modelApi.generate(ctx,'deliberation',{invocationId,promptParams:{roleMaterial:String(prepared.subject.roleMaterial??'')},situation:JSON.stringify({currentReadRefs:prepared.materials.map(m=>m.ref),life:prepared.situation,opportunities:prepared.opportunities.map((o,index)=>({messageRef:`m${index+1}`,conversationRef:`c${conversations.findIndex(c=>c.id===o.conversationId)+1}`,alreadyRead:prepared.materials.some(m=>m.ref.id===(o.originRef as Json).id),notice:o.notice,kind:o.kind})),conversations:conversations.map((c,index)=>({id:`c${index+1}`,key:c.key})),commitments,pursuits}),query:prepared.materials.map(m=>m.text).join('\n'),materials:prepared.materials,schema:decisionDraft});
  const messages=new Map(prepared.opportunities.map((o,index)=>[`m${index+1}`,(o.originRef as Json).id as string]));const conversationRefs=new Map(conversations.map((c,index)=>[`c${index+1}`,c.id as string]));
  const actions=(proposal.actions as any[]).map(action=>action.kind==='read'?{...action,messageIds:action.messageIds.map((ref:string)=>{const id=messages.get(ref);if(!id)problem('invalid_input',`Unknown readable message reference ${ref}`);return id;})}:action);
  const expressionIntent=proposal.expressionIntent?{...proposal.expressionIntent,conversationId:conversationRefs.get(proposal.expressionIntent.conversationId)??problem('invalid_input','Unknown conversation reference'),audience:[String(conversations.find(c=>c.id===conversationRefs.get(proposal.expressionIntent!.conversationId))!.key)],sourceRefs:prepared.materials.map(material=>material.ref)}:undefined;
  return decision.parse({...proposal,actions,expressionIntent});

 }
 async function adopt(ctx:CallContext,chosen:Decision,opportunityIds:string[],trigger='manual'){return transaction('agency.adoptDecision',async tx=>{await tx.selectFrom('subjects').select('id').where('id','=',subjectIdOf(ctx)).forUpdate().execute();
  const currentSubject=await read(tx,'subjects',subjectIdOf(ctx),subjectIdOf(ctx));if(currentSubject.runtime!=='running')problem('capability_unavailable','Subject stopped before decision adoption',409);
  const situation=await worldApi.advanceIn(tx,ctx,undefined,'decision_adopt');const decisionId=v7();const effects:Json[]=[];
  for(const action of chosen.actions){
   if(action.kind==='activity'){const at=situation.time;effects.push(await put(tx,'activities',subjectIdOf(ctx),{title:action.title,kind:action.activityKind,start:at,end:parseTimePoint({...at,at:new Date(Date.parse(at.at)+action.durationMinutes*60000).toISOString()}),interruptibility:action.interruptibility,status:'active',decisionId}));}
   if(action.kind==='pursuit')effects.push(await put(tx,'pursuits',subjectIdOf(ctx),{...action,status:'active',decisionId}));
   if(action.kind==='schedule')effects.push(await put(tx,'calendarRules',subjectIdOf(ctx),{title:action.title,start:action.start.at.replace('Z',''),timezone:'UTC',durationMinutes:action.durationMinutes,adherence:'free',activityKind:'other',interruptibility:'open',decisionId}));
   if(action.kind==='delegate')effects.push(await put(tx,'tasks',subjectIdOf(ctx),{goal:action.goal,allowedTools:action.allowedTools,inputRefs:action.inputRefs,status:'queued',returnTarget:chosen.expressionIntent?{conversationId:chosen.expressionIntent.conversationId}:{},decisionId}));
  }
  const adopted=await put(tx,'decisions',subjectIdOf(ctx),{...chosen,trigger,operationId:ctx.trace.operationId,observed:situation.time,effects:effects.map(e=>({id:e.id})),opportunityIds},decisionId);
  for(const id of opportunityIds){const o=await read(tx,'opportunities',subjectIdOf(ctx),id);await put(tx,'opportunities',subjectIdOf(ctx),{...o,state:'decided',decisionId,actualPortions:chosen.actions.filter(a=>a.kind==='read')},id,o.revision as number);}
  return adopted;
 });}
 async function render(ctx:CallContext,adopted:Json,invocationId:string){const intent=adopted.expressionIntent as Json;if(!intent)return null;const communication=await config.communication(subjectIdOf(ctx));if(!adopted.opportunityIds||!(adopted.opportunityIds as string[]).length){if(!communication.behavior.proactive)return null;}const outward={...ctx,purpose:'expression',audience:intent.audience as string[]};
  const conversation=await communicationApi.conversation(outward,intent.conversationId as string);const known=(await list(db,'opportunities',subjectIdOf(ctx))).filter(o=>o.readAt).map(o=>(o.originRef as Json).id);const history=conversation.messages.filter(m=>(m.direction==='outbound'||known.includes(m.id))&&permits(m.policy as Policy,outward)).slice(-12);const output=await modelApi.generate<any>(outward,'expression',{invocationId,promptParams:{structured:Boolean(intent.commitment)},situation:JSON.stringify({intent,recentConversation:history.map(m=>({id:m.id,author:m.authorId,direction:m.direction}))}),materials:history.map(m=>({ref:makeRef(installationId,subjectIdOf(ctx),'message',m.id as string,m.revision as number),text:`${m.authorId}: ${readableParts(m.parts as any)}`,policy:m.policy as Policy,occurred:{start:m.sentAt as TimePoint}})),schema:intent.commitment?expressionDraft:undefined});const draft=intent.commitment?expressionDraft.parse(output):{parts:[{partId:v7(),kind:'text' as const,text:String(output)}],semanticChanges:[]};
  return transaction('agency.adoptExpression',async tx=>{const expression=await communicationApi.createExpression(tx,outward,{intent,parts:draft.parts,decisionId:adopted.id as string,modelOperationId:invocationId});
   if(intent.commitment)await put(tx,'commitments',subjectIdOf(ctx),{...intent.commitment as Json,audience:intent.audience,expressionId:expression.id,status:'prepared',communicatedParts:[],changes:[]});
   for(const change of draft.semanticChanges){if(change.kind==='world_detail')await put(tx,'realizedEvents',subjectIdOf(ctx),{facts:[change.body],sourceRefs:change.sourceRefs,expressionId:expression.id,formed:readReal(),recorded:readReal()});await put(tx,'statements',subjectIdOf(ctx),{...change,expressionId:expression.id,audience:intent.audience});}
   return expression;
  });
 }
 return {prepare,choose,adopt,render,
 async readMessages(ctx:CallContext,ids:string[]){
  await authorize(ctx,'messages.read');const opportunities=await list(db,'opportunities',subjectIdOf(ctx));
  return (await Promise.all(ids.map(async id=>{
   const opportunity=opportunities.find(o=>(o.originRef as Json).id===id);
   if(opportunity?.kind==='work'){
    const task=await read(db,'tasks',subjectIdOf(ctx),id);
    if(!task.result)problem('capability_unavailable','Task result is unavailable',409);
    if(task.cognitionBound||task.cognitionAuthority||task.resultPublication){
     const publication=task.resultPublication as Json|undefined;
     if(publication?.status!=='published')problem('capability_unavailable','Task result publication is pending',409);
     const refs=RefSchema.array().min(1).parse(publication.refs);
     return Promise.all(refs.map(async ref=>{const material=await cognition.read(ctx,ref);if(material.text===undefined)problem('capability_unavailable','Selected Task result has no saved text',409);return {ref:material.ref,text:material.text,policy:material.policy,occurred:material.occurred??{start:task.resultRecordedAt as TimePoint}};}));
    }
    const result=task.result as Json;
    if(typeof result.text!=='string')problem('capability_unavailable','Native Task result has no saved text',409);
    return [{ref:makeRef(installationId,subjectIdOf(ctx),'task',id,task.revision as number),text:result.text,policy:{readers:[subjectIdOf(ctx)],purposes:['deliberation','expression','growth'],audiences:ctx.audience.length?ctx.audience:['*']},occurred:{start:task.resultRecordedAt as TimePoint}}];
   }
   const m=await communicationApi.readMessage(ctx,id);return [{ref:makeRef(installationId,subjectIdOf(ctx),'message',id,m.revision as number),text:`${m.authorName??m.authorId}: ${readableParts(m.parts as any)}`,policy:m.policy as Policy,occurred:{start:m.sentAt as TimePoint}}];
  }))).flat();
 },
 async noteRead(ctx:CallContext,ids:string[]){return transaction('agency.noteActualRead',async tx=>{for(const o of await list(tx,'opportunities',subjectIdOf(ctx))){if(ids.includes((o.originRef as Json).id as string))await put(tx,'opportunities',subjectIdOf(ctx),{...o,state:'read',readAt:readReal()},o.id as string,o.revision as number);}});},
 async explain(ctx:CallContext,conversationId?:string){await authorize(ctx,'agency.read');const opportunities=(await list(db,'opportunities',subjectIdOf(ctx))).filter(o=>!conversationId||o.conversationId===conversationId);const subject=await read(db,'subjects',subjectIdOf(ctx),subjectIdOf(ctx));const lastDecision=(await list(db,'decisions',subjectIdOf(ctx))).at(-1);return {runtime:subject.runtime,opportunities:opportunities.map(o=>({id:o.id,state:o.state,decisionId:o.decisionId})),reason:subject.runtime!=='running'?'主体已暂停或停止':lastDecision?.internalReason??(opportunities.some(o=>o.state==='unnoticed')?'通知尚未察觉':'当前没有待处理通知'),lastDecisionId:lastDecision?.id};},
 async readDecision(ctx:CallContext,id:string){await authorize(ctx,'agency.read');return read(db,'decisions',subjectIdOf(ctx),id);},
 async pursuits(ctx:CallContext,input?:unknown){await authorize(ctx,input?'pursuits.write':'pursuits.read');return input?put(db,'pursuits',subjectIdOf(ctx),pursuitInput.parse(input)):{items:await list(db,'pursuits',subjectIdOf(ctx))};},
 async changePursuit(ctx:CallContext,id:string,input:Json){await authorize(ctx,'pursuits.write');const old=await read(db,'pursuits',subjectIdOf(ctx),id);return put(db,'pursuits',subjectIdOf(ctx),pursuitInput.parse({...old,...input}),id,input.expectedRevision as number);},
 async commitment(ctx:CallContext,id:string){await authorize(ctx,'commitments.read');return read(db,'commitments',subjectIdOf(ctx),id);},
 async evaluateCommitment(ctx:CallContext,id:string,input:{status:'fulfilled'|'breached'|'released'|'unknown';basisRefs:unknown[];coverage:string}){await authorize(ctx,'commitments.write');const old=await read(db,'commitments',subjectIdOf(ctx),id);if(input.status==='breached'&&input.coverage!=='complete')problem('invalid_input','Breach needs complete observation coverage');return put(db,'commitments',subjectIdOf(ctx),{...old,status:input.status,fulfillmentBasis:input},id,old.revision as number);},
 async proposeCommitmentChange(ctx:CallContext,id:string,input:Json){await authorize(ctx,'commitments.write');const old=await read(db,'commitments',subjectIdOf(ctx),id);return put(db,'commitments',subjectIdOf(ctx),{...old,proposedChange:input},id,old.revision as number);},
 async cancelNode(ctx:CallContext){const old=(await list(db,'nextNodes',subjectIdOf(ctx)))[0];if(old)await put(db,'nextNodes',subjectIdOf(ctx),{...old,state:'cancelled'},old.id as string,old.revision as number);},
 async nextNode(ctx:CallContext,at:TimePoint,reason:string,projection:Json={}){return transaction('agency.nextNode',async tx=>{const previous=(await list(tx,'nextNodes',subjectIdOf(ctx)))[0];return put(tx,'nextNodes',subjectIdOf(ctx),{at,reasons:[reason],state:'active',...projection},previous?.id as string|undefined,previous?.revision as number|undefined);});}
 };
}
