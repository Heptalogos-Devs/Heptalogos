import {ClockRateSchema,ClockOfflinePolicySchema} from '@nous-wave/contracts/time';
import {parseInstant} from '@nous-wave/platform/time';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {parseTOML} from 'confbox';
import {unzipSync,strFromU8} from 'fflate';
import {z} from 'zod';
import {worldPackage} from '@heptalogos/contracts';
const entry=z.object({formatVersion:z.literal(1),title:z.string(),defaultTimezone:z.string(),entryPoint:z.string(),background:z.string(),places:z.string(),characters:z.string(),calendar:z.string(),rules:z.string(),initialState:z.string(),clock:z.object({mode:z.enum(['sync','scaled']).default('scaled'),initialTime:z.string(),rate:ClockRateSchema,offlinePolicy:ClockOfflinePolicySchema}),visibility:z.object({publicFiles:z.array(z.string()),authorFiles:z.array(z.string())})});
export async function loadWorldPackage(source:string){
 const directory=(await stat(source)).isDirectory();const files=directory?undefined:unzipSync(await readFile(source));
 const text=async(name:string)=>{if(path.isAbsolute(name)||name.split('/').includes('..'))throw new Error('World package paths must stay inside the package');if(files){if(!files[name])throw new Error(`Missing world package file: ${name}`);return strFromU8(files[name]);}return readFile(path.join(source,name),'utf8');};
 const manifest=entry.parse(parseTOML(await text('world.toml')));const [background,rules,places,characters,calendar,initial]=await Promise.all([text(manifest.background),text(manifest.rules),text(manifest.places).then(JSON.parse),text(manifest.characters).then(JSON.parse),text(manifest.calendar).then(JSON.parse),text(manifest.initialState).then(JSON.parse)]);
 return worldPackage.parse({formatVersion:1,title:manifest.title,background,rules,visibility:manifest.visibility,clock:{initialAt:parseInstant(manifest.clock.initialTime),rate:manifest.clock.mode==='sync'?'1':manifest.clock.rate,timezone:manifest.defaultTimezone,offlinePolicy:manifest.clock.offlinePolicy},entryPoint:manifest.entryPoint,initialState:initial,places:places.places.map((place:any)=>({key:place.key,title:place.name,description:place.publicDescription,devices:place.devices,neighbors:places.routes.flatMap((route:any)=>route.from===place.key?[{to:route.to,minutes:route.durationMinutes}]:route.to===place.key?[{to:route.from,minutes:route.durationMinutes}]:[])})),characters:characters.characters.map((character:any)=>({key:character.key,name:character.name,description:[character.role,...character.publicFacts].join('；'),place:character.place??manifest.entryPoint,privateNotes:character.authorNotes})),calendar:calendar.rules.map((rule:any)=>({...rule,start:rule.startLocal,placeId:rule.place,activityKind:rule.activityKind??(rule.key==='night-sleep'?'sleep':rule.key==='technical-class'?'study':'other')}))});
}
