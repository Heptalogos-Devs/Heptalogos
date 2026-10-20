import {NodeSDK} from '@opentelemetry/sdk-node';
import {context,trace,propagation,SpanStatusCode} from '@opentelemetry/api';
export function startTelemetry(installationId:string){const sdk=new NodeSDK({serviceName:'heptalogos',...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT?{}:{spanProcessors:[]})});sdk.start();return {close:()=>sdk.shutdown()};}
export function currentTrace(){const span=trace.getSpan(context.active());const headers:Record<string,string>={};propagation.inject(context.active(),headers);return span?{traceId:span.spanContext().traceId,traceparent:headers.traceparent}:undefined;}
export async function traced<T>(name:string,headers:Record<string,string>,fn:()=>Promise<T>){const parent=propagation.extract(context.active(),headers);return trace.getTracer('heptalogos').startActiveSpan(name,{},parent,async span=>{try{return await fn();}catch(error){span.setStatus({code:SpanStatusCode.ERROR,message:error instanceof Error?error.message:String(error)});throw error;}finally{span.end();}});}

export function operationTrace(){const current=currentTrace();if(current)return current;const span=trace.getTracer('heptalogos').startSpan('hept.operation');const carrier:Record<string,string>={};propagation.inject(trace.setSpan(context.active(),span),carrier);const traceId=span.spanContext().traceId;span.end();return {traceId,traceparent:carrier.traceparent};}
