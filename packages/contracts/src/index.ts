import { z } from 'zod';
export type { Actor, CallContext, Ref, TimePoint, Policy } from '@nous-wave/contracts/common';
import { ObjectIdSchema, TimePointSchema, RefSchema, PolicySchema } from '@nous-wave/contracts/common';
export const id = ObjectIdSchema;
export const time = TimePointSchema;
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
export const channelSchema=z.object({host:z.enum(['local','astrbot']),accountId:z.string(),endpoint:z.url().optional(),credentialRef:z.string().optional(),conversationKeys:z.array(z.string()).default(['*']),receive:z.boolean().default(true),participate:z.boolean().default(true),send:z.boolean().default(true)});
export const modelResource=z.object({id:z.string().min(1),provider:z.literal('openai-compatible'),baseURL:z.url(),modelId:z.string(),credentialRef:z.string(),contextLimit:z.number().int().positive().default(32000),outputLimit:z.number().int().positive().default(2048),pricing:z.object({inputPerMillion:z.number().nonnegative(),outputPerMillion:z.number().nonnegative()}).optional(),capabilities:z.array(z.string()).default(['text']),providerOptions:z.record(z.string(),z.record(z.string(),z.json())).default({})});
const settingMeta=(scopes:string[],effect:string,permission='settings.write')=>({'x-scopes':scopes,'x-effect':effect,'x-permission':permission,'x-level':'Standard'});
export const settingsSchema=z.object({
 deliberationModel:z.string().optional().meta(settingMeta(['installation','subject','role'],'next_call')),
 expressionModel:z.string().optional().meta(settingMeta(['installation','subject','role'],'next_call')),
 authorModel:z.string().optional().meta(settingMeta(['installation','subject','role'],'next_call')),
 growthModel:z.string().optional().meta(settingMeta(['installation','subject','role'],'next_call')),
 nous:z.object({baseURL:z.url(),credentialRef:z.string()}).strict().optional().meta(settingMeta(['installation','subject'],'next_call','installation.manage')),
 budget:z.object({dailyCalls:z.number().int().nonnegative().default(100),dailyUsd:z.number().nonnegative().optional()}).strict().default({dailyCalls:100}).meta(settingMeta(['installation','subject','role'],'next_call')),
 attention:z.object({aggregationMs:z.number().nonnegative().default(1500),freeMinutes:z.number().positive().default(60),dailyAutonomousCalls:z.number().int().nonnegative().default(12)}).strict().default({aggregationMs:1500,freeMinutes:60,dailyAutonomousCalls:12}).meta(settingMeta(['installation','subject'],'hot')),
 behavior:z.object({receive:z.boolean().default(true),participate:z.boolean().default(true),proactive:z.boolean().default(false),allowedConversations:z.array(z.string()).default(['*'])}).strict().default({receive:true,participate:true,proactive:false,allowedConversations:['*']}).meta(settingMeta(['installation','subject'],'hot')),
 world:z.object({timezone:z.string().default('Asia/Tokyo'),offlinePolicy:z.enum(['freeze','catch_up']).default('freeze')}).strict().default({timezone:'Asia/Tokyo',offlinePolicy:'freeze'}).meta(settingMeta(['installation','subject'],'hot')),
 media:z.object({maxBytes:z.number().positive().default(52428800),dailyBytes:z.number().positive().default(1073741824)}).strict().default({maxBytes:52428800,dailyBytes:1073741824}).meta(settingMeta(['installation','subject'],'next_call')),
}).strict();

export const demands=z.partialRecord(z.enum(['vision','hearing','language','reasoning','hands','mobility']),z.enum(['none','light','focused']));
export const calendarRule=z.object({title:z.string(),start:z.string(),timezone:z.string(),durationMinutes:z.number().positive(),rrule:z.string().optional(),placeId:z.string().optional(),characterId:z.string().optional(),demands:demands.default({}),adherence:z.enum(['free','expected','binding']).default('free'),activityKind:z.enum(['sleep','rest','study','exercise','social','travel','other']).default('other'),interruptibility:z.enum(['open','glance','brief','closed']).default('open')});
export const worldPackage=z.object({formatVersion:z.literal(1),title:z.string(),background:z.string(),rules:z.string().default(''),visibility:z.object({publicFiles:z.array(z.string()),authorFiles:z.array(z.string())}).optional(),initialState:z.object({place:z.string(),energy:z.number().min(0).max(1).default(1),fatigue:z.number().min(0).max(1).default(0),mood:z.unknown().optional(),availableDevices:z.array(z.string()).default([]),nextActivity:z.string().optional()}).optional(),clock:z.object({worldAnchor:z.iso.datetime(),rate:z.number().nonnegative().default(1),timezone:z.string().default('Asia/Tokyo'),offlinePolicy:z.enum(['freeze','catch_up']).default('freeze')}),entryPoint:z.string(),places:z.array(z.object({id:id.optional(),key:z.string(),title:z.string(),description:z.string(),neighbors:z.array(z.object({to:z.string(),minutes:z.number().positive()})).default([]),devices:z.array(z.string()).default([])})),characters:z.array(z.object({id:id.optional(),key:z.string(),name:z.string(),description:z.string(),place:z.string(),privateNotes:z.string().optional()})).default([]),calendar:z.array(calendarRule).default([])});
export const taskBudget=z.object({maxCalls:z.number().int().positive().optional(),maxTokens:z.number().int().positive().optional(),maxUsd:z.number().nonnegative().optional(),perCallUsd:z.number().nonnegative().optional()});
export const taskRequest=z.object({clientSubmissionId:z.string(),goal:z.string(),pursuitRef:ref.optional(),activityRef:ref.optional(),workContextId:z.string().optional(),inputRefs:z.array(ref).default([]),allowedTools:z.array(z.string()).default([]),workspaceRef:z.string().optional(),budget:taskBudget.optional(),returnTarget:z.object({conversationId:id.optional(),messageId:id.optional()}).default({})});
export const pursuitInput=z.object({title:z.string(),plan:z.string(),motivationRefs:z.array(ref).default([]),reviewAt:time.optional(),status:z.enum(['active','paused','completed','abandoned']).default('active')});
export const bootstrapSchema=z.object({databaseURL:z.string(),installationId:z.string(),dataRoot:z.string(),host:z.string().default('127.0.0.1'),port:z.number().int().default(8788),publicURL:z.url().optional(),authSecretRef:z.string(),clientCredentialRef:z.string().default('administrator'),openclaw:z.object({endpoint:z.url(),credentialRef:z.string()}).optional()});
export type ReceiveMessage=z.infer<typeof receiveMessage>;
export type Decision=z.infer<typeof decision>;
export type ExpressionIntent=z.infer<typeof expressionIntent>;
export type ModelResource=z.infer<typeof modelResource>;
export type Settings=z.infer<typeof settingsSchema>;
export type WorldPackage=z.infer<typeof worldPackage>;
export type TaskRequest=z.infer<typeof taskRequest>;
