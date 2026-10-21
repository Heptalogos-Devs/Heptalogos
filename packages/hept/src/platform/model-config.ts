import {z} from 'zod';
import type {RoleDescriptor} from '@nous-wave/platform/models';
import type {PromptDescriptor} from '@nous-wave/platform/prompts';
export const roleCatalog:readonly RoleDescriptor[]=[
 {id:'deliberation',label:'思考与选择',description:'依据当前生活及实际获知资料选择行动',kind:'language',requiredCapabilities:['text','structured'],defaultPolicy:{kind:'language',enabled:false,resources:[],selection:'ordered',timeoutMs:120000,prompt:{promptId:'hept.deliberation',locale:'zh-CN'},inference:{maxOutputTokens:2048,providerOptions:{}}}},
 {id:'expression',label:'向实际听众表达',description:'表达已经采用且允许披露的意图',kind:'language',requiredCapabilities:['text'],defaultPolicy:{kind:'language',enabled:false,resources:[],selection:'ordered',timeoutMs:120000,prompt:{promptId:'hept.expression',locale:'zh-CN'},inference:{maxOutputTokens:2048,providerOptions:{}}}},
 {id:'worker',label:'原生任务模型',description:'保留OpenClaw实际任务、工具、历史与skills',kind:'language',requiredCapabilities:['input:text'],defaultPolicy:{kind:'language',enabled:false,resources:[],selection:'ordered',timeoutMs:120000,inference:{maxOutputTokens:2048,providerOptions:{}}}},
];
export const promptCatalog:readonly PromptDescriptor[]=[
 {id:'hept.deliberation',owner:'hept.agency',labelKey:'hept.prompts.deliberation',descriptionKey:'hept.prompts.deliberation.description',visibility:'standard',locales:['zh-CN'],defaultLocale:'zh-CN',programFiles:{'zh-CN':'deliberation.liquid'},paramsSchema:z.strictObject({roleMaterial:z.string()}),paramsSchemaRevision:'1',examples:{'zh-CN':{roleMaterial:'以实际阅读和生活经历认识周围。'}},allowedPartials:[]},
 {id:'hept.expression',owner:'hept.communication',labelKey:'hept.prompts.expression',descriptionKey:'hept.prompts.expression.description',visibility:'standard',locales:['zh-CN'],defaultLocale:'zh-CN',programFiles:{'zh-CN':'expression.liquid'},paramsSchema:z.strictObject({structured:z.boolean()}),paramsSchemaRevision:'1',examples:{'zh-CN':{structured:false}},allowedPartials:[]},
];
