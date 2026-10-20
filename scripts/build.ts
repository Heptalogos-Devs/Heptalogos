import { spawnSync } from 'node:child_process';
import { cp,mkdir,readFile,writeFile,readdir,rm } from 'node:fs/promises';
import path from 'node:path';
const compiler=path.resolve('node_modules/typescript/bin/tsc');
function compile(args:string[]){const result=spawnSync(process.execPath,[compiler,...args],{stdio:'inherit'});if(result.status!==0)throw new Error(`TypeScript build failed (${result.status})`);}
compile(['-p','tsconfig.json']);
const output=path.resolve('data/product');await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
for(const directory of ['apps','packages','migrations','integrations'])try{await cp(path.join('data/build',directory),path.join(output,directory),{recursive:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
for(const name of ['contracts','client']){
 const source=path.resolve('../Nous-Wave/packages',name),destination=path.join(output,'vendor',`nous-${name}`);await mkdir(destination,{recursive:true});
 const entryFiles=(await readdir(source)).filter(file=>file.endsWith('.ts')).map(file=>path.join(source,file));
 if(name==='client'){entryFiles.push(path.join(source,'src/index.ts'));try{await readFile(path.join(source,'src/generated/index.ts'));entryFiles.push(path.join(source,'src/generated/index.ts'));}catch{}}
 compile(['--ignoreConfig','--target','ES2023','--module','NodeNext','--moduleResolution','NodeNext','--customConditions','development','--skipLibCheck','--declaration','--rootDir',source,'--outDir',destination,...entryFiles]);
 const manifest=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));function target(value:any):any{const entry=typeof value==='string'?value:value.development??value.default;return {types:entry.replace(/\.ts$/,'.d.ts'),default:entry.replace(/\.ts$/,'.js')};}manifest.exports=typeof manifest.exports==='string'?target(manifest.exports):Object.fromEntries(Object.entries(manifest.exports).map(([key,value])=>[key,target(value)]));
 if(manifest.dependencies?.['@nous-wave/contracts'])manifest.dependencies['@nous-wave/contracts']='workspace:*';await writeFile(path.join(destination,'package.json'),JSON.stringify(manifest,null,2));
}
for(const name of ['contracts','client','hept']){const manifest=JSON.parse(await readFile(`packages/${name}/package.json`,'utf8'));manifest.exports='./src/index.js';for(const key of Object.keys(manifest.dependencies??{}))if(key.startsWith('@nous-wave/'))manifest.dependencies[key]='workspace:*';await writeFile(path.join(output,'packages',name,'package.json'),JSON.stringify(manifest,null,2));}
const root=JSON.parse(await readFile('package.json','utf8'));delete root.devDependencies;root.scripts={serve:'node apps/server/src/index.js',hept:'node apps/cli/src/index.js'};root.bin={hept:'apps/cli/src/index.js'};for(const key of Object.keys(root.dependencies))if(key.startsWith('@nous-wave/'))root.dependencies[key]='workspace:*';
await writeFile(path.join(output,'package.json'),JSON.stringify(root,null,2));await writeFile(path.join(output,'pnpm-workspace.yaml'),"packages:\n  - packages/*\n  - vendor/*\nautoInstallPeers: false\noverrides:\n  kysely: 0.29.7\n");
for(const file of ['LICENSE','README.md'])await cp(file,path.join(output,file));await cp('examples',path.join(output,'examples'),{recursive:true});await cp('worlds',path.join(output,'worlds'),{recursive:true});
console.log(`Compiled ESM product: ${output}`);
