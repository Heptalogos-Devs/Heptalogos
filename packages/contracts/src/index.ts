import {ModelBudgetSchema} from '@nous-wave/contracts/models';
import {InstantInputSchema} from '@nous-wave/contracts/common';
import {ClockRateSchema,ClockOfflinePolicySchema} from '@nous-wave/contracts/time';
import { z } from 'zod';
export type { Actor, CallContext, Ref, TimePoint, Policy } from '@nous-wave/contracts/common';
import { ConsumerSchema,JsonValueSchema,ObjectIdSchema, TimePointInputSchema, RefSchema, PolicySchema } from '@nous-wave/contracts/common';
export const id = ObjectIdSchema;
export const time = TimePointInputSchema;
export const ref = RefSchema;
export const policy = PolicySchema;
export const defaultPolicy = {readers:['*'],purposes:['*'],audiences:['*']};
const partBase = { partId:z.string().min(1) };
export const messagePart: z.ZodType<MessagePart> = z.lazy(()=>z.discriminatedUnion('kind',[
 z.object({...partBase,kind:z.literal('text'),text:z.string()}),
 z.object({...partBase,kind:z.literal('mention'),accountId:z.string(),displayName:z.string().optional()}),
 z.object({...partBase,kind:z.literal('reply'),messageRef:ref.optional(),platformMessageId:z.string(),status:z.enum(['resolved','unavailable','pending']).default('pending')}),
 z.object({...partBase,kind:z.enum(['image','sticker','audio','video','file']),materialRef:ref.optional(),url:z.string().optional(),name:z.string().optional(),mediaType:z.string().optional(),description:z.string().optional(),availability:z.enum(['pending','available','missing','too_large']).default('pending')}),
 z.object({...partBase,kind:z.literal('link'),url:z.url(),title:z.string().optional()}),
 z.object({...partBase,kind:z.enum(['card','unsupported']),description:z.string(),raw:z.unknown().optional()}),
 z.object({...partBase,kind:z.literal('forward'),nodes:z.array(z.object({nodeId:z.string(),authorId:z.string(),authorName:z.string().optional(),sentAt:time.optional(),sourceRef:ref.optional(),parts:z.array(messagePart)}))})
])).meta({id:'HeptMessagePart'});
export type MessagePart = {partId:string}&({kind:'text';text:string}|{kind:'mention';accountId:string;displayName?:string}|{kind:'reply';messageRef?:z.infer<typeof ref>;platformMessageId:string;status:'resolved'|'unavailable'|'pending'}|{kind:'image'|'sticker'|'audio'|'video'|'file';materialRef?:z.infer<typeof ref>;url?:string;name?:string;mediaType?:string;description?:string;availability:'pending'|'available'|'missing'|'too_large'}|{kind:'link';url:string;title?:string}|{kind:'card'|'unsupported';description:string;raw?:unknown}|{kind:'forward';nodes:{nodeId:string;authorId:string;authorName?:string;sentAt?:z.infer<typeof time>;sourceRef?:z.infer<typeof ref>;parts:MessagePart[]}[]});
export const subjectCreate=z.object({id:id.optional(),displayName:z.string().min(1),roleMaterial:z.string().default(''),capabilities:z.array(z.string()).default(['communication','world','agency','work']),clientSubmissionId:z.string().min(1)});
export const receiveMessage=z.object({clientSubmissionId:z.string().min(1),conversationId:id.optional(),conversationKey:z.string().min(1),channelAccount:z.string().default('local'),platformMessageId:z.string().min(1),authorId:z.string().min(1),authorName:z.string().optional(),sentAt:time.optional(),parts:z.array(messagePart).min(1),raw:z.unknown().optional(),policy:policy.optional()});
export const messageChange=z.object({messageId:id.optional(),source:z.object({channelAccount:z.string(),conversationKey:z.string(),platformMessageId:z.string()}).optional(),kind:z.enum(['edit','retract','feedback']),parts:z.array(messagePart).optional(),expectedRevision:z.number().int().positive().optional(),sourceEventId:z.string().min(1)}).refine(value=>Boolean(value.messageId)!==Boolean(value.source),'Provide exactly one message identity');
export const expressionIntent=z.object({conversationId:id,audience:z.array(z.string()),purpose:z.string(),posture:z.string().default('natural'),facts:z.array(z.string()).default([]),sourceRefs:z.array(ref).default([]),commitment:z.object({terms:z.string(),dueAt:time.optional()}).optional()});
export const action=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('read'),messageIds:z.array(id)}),
 z.object({kind:z.enum(['continue','wait','dismiss']),reason:z.string()}),
 z.object({kind:z.literal('activity'),title:z.string(),activityKind:z.enum(['sleep','rest','study','exercise','social','travel','other']),durationMinutes:z.number().positive(),interruptibility:z.enum(['open','glance','brief','closed']).default('open')}),
 z.object({kind:z.literal('pursuit'),title:z.string(),plan:z.string(),reviewAt:time.optional()}),
 z.object({kind:z.literal('delegate'),goal:z.string(),allowedTools:z.array(z.string()),inputRefs:z.array(ref).default([])}),
 z.object({kind:z.literal('schedule'),title:z.string(),start:time,durationMinutes:z.number().positive()})
]);
export const decision=z.object({focus:z.string(),actions:z.array(action),internalReason:z.string(),resumeCue:z.string().optional(),reconsiderAt:time.optional(),expressionIntent:expressionIntent.optional()});
export const decisionDraft=decision.extend({actions:z.array(z.discriminatedUnion('kind',[action.options[0].extend({messageIds:z.array(z.string())}),...action.options.slice(1)] as any)),expressionIntent:expressionIntent.omit({audience:true}).extend({conversationId:z.string()}).optional()});
export const expressionDraft=z.object({parts:z.array(messagePart).min(1),semanticChanges:z.array(z.object({partId:z.string(),kind:z.enum(['world_detail','commitment','correction']),body:z.string(),sourceRefs:z.array(ref).default([])})).default([])});
export const deliveryPart=z.object({partId:id,expressionPartRefs:z.array(z.string()),platformMessageId:z.string().optional(),attemptedAt:time,status:z.enum(['accepted','not_sent','unknown']),error:z.string().optional(),nativeReceiptRef:z.string().optional()});
export const resourceNetwork=z.strictObject({profileId:z.string().default('default'),addressScope:z.enum(['public','configured_private']).default('public'),allowedPrivateRanges:z.array(z.string()).default([])});
export const channelSchema=z.object({host:z.enum(['local','astrbot']),adapterId:z.string().min(1),accountId:z.string().min(1),endpoint:z.url().optional(),credentialRef:z.string().optional(),conversationKeys:z.array(z.string()).default(['*']),receive:z.boolean().default(true),participate:z.boolean().default(true),send:z.boolean().default(true),network:resourceNetwork.default({profileId:'default',addressScope:'public',allowedPrivateRanges:[]})});
export const channelConfiguration=channelSchema.extend({id:id.optional(),expectedRevision:z.number().int().nonnegative().safe()}).meta({id:'ChannelConfiguration'});
export const mediaCaptureSource=z.object({channelAccount:z.string().min(1),conversationKey:z.string().min(1)}).meta({id:'MediaCaptureSource'});
export const mediaCaptureQuery=mediaCaptureSource.partial().refine(value=>Boolean(value.channelAccount)===Boolean(value.conversationKey),'Provide both account and conversation').meta({id:'MediaCaptureQuery'});
export const mediaCaptureResult=z.object({ref,bytes:z.number().int().nonnegative().safe(),mediaType:z.string(),name:z.string()}).meta({id:'MediaCaptureResult'});
export {ModelTestInputSchema as modelTestInput} from '@nous-wave/contracts/models';
export type {ModelTestInput} from '@nous-wave/contracts/models';
const cognitionCredential=z.strictObject({credentialRef:z.string().min(1),consumer:ConsumerSchema});
export const cognitionSettings=z.strictObject({nous:z.strictObject({baseURL:z.url(),subject:cognitionCredential,workerHost:cognitionCredential.optional(),network:resourceNetwork.default({profileId:'default',addressScope:'public',allowedPrivateRanges:[]})}).optional()});
export const executionSettings=z.strictObject({runtimes:z.record(z.string().min(1),z.strictObject({endpoint:z.url(),credentialRef:z.string().min(1),network:resourceNetwork.default({profileId:'default',addressScope:'public',allowedPrivateRanges:[]})}))});
export const attentionSettings=z.strictObject({aggregationMs:z.number().nonnegative(),freeMinutes:z.number().positive(),dailyAutonomousCalls:z.number().int().nonnegative()});
export const communicationSettings=z.strictObject({behavior:z.strictObject({receive:z.boolean(),participate:z.boolean(),proactive:z.boolean(),allowedConversations:z.array(z.string())}),media:z.strictObject({maxBytes:z.number().positive(),dailyBytes:z.number().positive()})});
export const worldSettings=z.strictObject({timezone:z.string()});
export type CognitionSettings=z.infer<typeof cognitionSettings>;
export type ExecutionSettings=z.infer<typeof executionSettings>;
export type AttentionSettings=z.infer<typeof attentionSettings>;
export type CommunicationSettings=z.infer<typeof communicationSettings>;
export type WorldSettings=z.infer<typeof worldSettings>;
export const demands=z.partialRecord(z.enum(['vision','hearing','language','reasoning','hands','mobility']),z.enum(['none','light','focused']));
export const calendarRule=z.object({title:z.string(),start:z.string(),timezone:z.string(),durationMinutes:z.number().positive(),rrule:z.string().optional(),rdates:z.array(z.string()).default([]),exdates:z.array(z.string()).default([]),disambiguation:z.enum(['compatible','earlier','later','reject']).default('compatible'),startShiftSeconds:z.number().int().default(0),placeId:z.string().optional(),characterId:z.string().optional(),demands:demands.default({}),adherence:z.enum(['free','expected','binding']).default('free'),activityKind:z.enum(['sleep','rest','study','exercise','social','travel','other']).default('other'),interruptibility:z.enum(['open','glance','brief','closed']).default('open')});
export const worldPackage=z.object({formatVersion:z.literal(1),title:z.string(),background:z.string(),rules:z.string().default(''),visibility:z.object({publicFiles:z.array(z.string()),authorFiles:z.array(z.string())}).optional(),initialState:z.object({place:z.string(),energy:z.number().min(0).max(1).default(1),fatigue:z.number().min(0).max(1).default(0),mood:z.unknown().optional(),availableDevices:z.array(z.string()).default([]),nextActivity:z.string().optional()}).optional(),clock:z.object({initialAt:InstantInputSchema,rate:ClockRateSchema,timezone:z.string().default('Asia/Tokyo'),offlinePolicy:ClockOfflinePolicySchema}),entryPoint:z.string(),places:z.array(z.object({id:id.optional(),key:z.string(),title:z.string(),description:z.string(),neighbors:z.array(z.object({to:z.string(),minutes:z.number().positive()})).default([]),devices:z.array(z.string()).default([])})),characters:z.array(z.object({id:id.optional(),key:z.string(),name:z.string(),description:z.string(),place:z.string(),privateNotes:z.string().optional()})).default([]),calendar:z.array(calendarRule).default([])});
export const taskBudget=ModelBudgetSchema;
export const taskRequest=z.object({clientSubmissionId:z.string().min(1),goal:z.string().min(1),pursuitRef:ref.optional(),activityRef:ref.optional(),workContextId:z.string().optional(),inputRefs:z.array(ref).default([]),allowedTools:z.array(z.string()).default([]),workspaceRef:ref.optional(),budget:taskBudget.optional(),expiresAt:time.refine(value=>value.domainId==='real','Task authority expiry uses the real domain').optional(),returnTarget:z.object({conversationId:id.optional(),messageId:id.optional()}).default({})});
export const pursuitInput=z.object({title:z.string(),plan:z.string(),motivationRefs:z.array(ref).default([]),reviewAt:time.optional(),status:z.enum(['active','paused','completed','abandoned']).default('active')});
export type ReceiveMessage=z.infer<typeof receiveMessage>;
export type Decision=z.infer<typeof decision>;
export type ExpressionIntent=z.infer<typeof expressionIntent>;
export type WorldPackage=z.infer<typeof worldPackage>;
export type TaskRequest=z.infer<typeof taskRequest>;
export const taskContinuation=z.strictObject({expectedRevision:z.number().int().positive().safe(),goal:z.string().min(1).optional()}).meta({id:'HeptTaskContinuation'});
export type TaskContinuation=z.infer<typeof taskContinuation>;
export const taskRecoveryPlanInput=z.strictObject({invocationId:id.optional()}).meta({id:'HeptTaskRecoveryPlanInput'});
export const taskRecovery=taskRecoveryPlanInput.extend({expectedRevision:z.number().int().positive().safe()}).meta({id:'HeptTaskRecovery'});

export const hostPhase=z.enum(['initialized','running','draining','stopped']);
const componentState=z.enum(['available','degraded','unavailable']);
export const hostStatus=z.object({
 product:z.literal('hept'),installationId:z.string(),state:hostPhase,
 process:z.object({state:componentState,acceptingWork:z.boolean()}),
 database:z.object({state:componentState}),auth:z.object({state:componentState}),
 native:z.object({state:componentState,required:z.boolean(),reason:z.string()}),
 models:z.object({state:componentState,required:z.boolean(),configured:z.string(),reason:z.string()}),
 index:z.object({state:componentState,required:z.boolean(),reason:z.string()}),
 channels:z.object({local:z.object({state:componentState}),configured:z.string(),externalProbe:z.string()}),
 subjects:z.object({count:z.string(),running:z.string()}),
}).meta({id:'HeptHostStatus'});
export const hostStop=z.object({mode:z.enum(['graceful','force']).default('graceful')});
export type HostStatus=z.infer<typeof hostStatus>;

export * from './native.js';

export type MediaCaptureSource=z.infer<typeof mediaCaptureSource>;
