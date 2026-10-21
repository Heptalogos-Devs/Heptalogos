import {managementScope} from '@heptalogos/hept/authorization';
import {Command} from 'commander';
import {readFile,stat,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {v7} from 'uuid';
import * as sdk from '@heptalogos/client';
import {createBootstrap,createServiceManager,createPostgresRuntime,postgresRuntimeRef,type BootstrapView,type DoctorFinding} from '@nous-wave/platform/bootstrap';
import {createBootstrapSecrets} from '@nous-wave/platform/credentials';
import {problem,safeProblem} from '@nous-wave/platform/errors';
import {readProtectedPassword,readProtectedJsonFromStdin} from './input.js';

export function createCli(){
 const cli=new Command().name('hept').description('Heptalogos 安装、管理与持续主体')
  .option('--config <file>','引导配置').option('--instance-home <directory>','独立实例目录')
  .option('--subject <id>','目标主体').option('--json','机器输出');
 const print=(value:unknown)=>{process.stdout.write(`${JSON.stringify(value,null,2)}\n`);};
 const programRoot=dirname(fileURLToPath(import.meta.resolve('@heptalogos/hept/package.json')));
 async function checks(view:BootstrapView):Promise<DoctorFinding[]>{
  const secrets=createBootstrapSecrets(view.paths.secret),findings:DoctorFinding[]=[];
  for(const ref of ['auth-signing','cli-auth']){const value=await secrets.status(ref);findings.push({code:`hept.${ref}`,state:value.available?'ok':'warning',message:value.available?'引导凭据可用':'引导凭据未配置或不可用'});}
  if(view.bootstrap.database.mode==='managed'){const runtime=await createPostgresRuntime(view).inspect(),password=await secrets.status(view.bootstrap.database.passwordRef);findings.push({code:'hept.database_runtime',state:runtime.state==='installed'?'ok':'unavailable',message:runtime.state==='installed'?'管理数据库运行时已安装':'请显式执行runtime acquire postgres'},{code:'hept.database_credential',state:password.available?'ok':'unavailable',message:password.available?'数据库引导凭据可用':'数据库引导凭据不可用'});return findings;}
  try{
   await secrets.withSecret(view.bootstrap.database.urlRef,{purpose:'bootstrap.database'},async value=>{
    const {createStorage}=await import('@nous-wave/platform/storage');
    const storage=createStorage<Record<string,never>>({pool:{connectionString:new TextDecoder().decode(value),max:1,connectionTimeoutMillis:3000},datasourceName:`doctor-${view.bootstrap.installationId}`,runDatasourceMigrations:false});
    try{await storage.pool.query('SELECT 1');findings.push({code:'hept.database',state:'ok',message:'数据库连接可用'});}
    finally{await storage.close();}
   });
  }catch(error){findings.push({code:safeProblem(error,'hept.database_unavailable').code,state:'unavailable',message:'数据库或其引导凭据不可用'});}
  return findings;
 }
 const bootstrap=()=>createBootstrap({product:'hept',programRoot,configPath:cli.opts().config,instanceHome:cli.opts().instanceHome,checks});
 function clientGroup(configuration:sdk.Configuration){return {host:new sdk.HostApi(configuration),subjects:new sdk.SubjectsApi(configuration),identity:new sdk.IdentityApi(configuration),messages:new sdk.MessagesApi(configuration),conversations:new sdk.ConversationsApi(configuration),agency:new sdk.AgencyApi(configuration),operations:new sdk.OperationsApi(configuration),worlds:new sdk.WorldsApi(configuration),world:new sdk.WorldApi(configuration),settings:new sdk.SettingsApi(configuration),secrets:new sdk.SecretsApi(configuration),network:new sdk.NetworkApi(configuration),models:new sdk.ModelsApi(configuration),providers:new sdk.ModelProvidersApi(configuration),tasks:new sdk.TasksApi(configuration),clock:new sdk.ClockApi(configuration),time:new sdk.TimeApi(configuration),data:new sdk.DataApi(configuration),costs:new sdk.CostsApi(configuration)};}
 async function withClient<T>(use:(client:ReturnType<typeof clientGroup>)=>Promise<T>,metadata:Parameters<typeof sdk.contextHeaders>[0]={}):Promise<T>{
  const view=await bootstrap().inspect(),secrets=createBootstrapSecrets(view.paths.secret);
  const baseURL=view.bootstrap.listen.publicBaseURL??`http://${view.bootstrap.listen.host}:${view.bootstrap.listen.port}`;
  return secrets.withSecret('cli-auth',{purpose:'cli.authentication'},bytes=>use(clientGroup(new sdk.Configuration({basePath:baseURL,accessToken:new TextDecoder().decode(bytes),middleware:[sdk.problemMiddleware],headers:sdk.contextHeaders({submissionId:v7(),...metadata}),fetchApi:(url,init)=>fetch(url,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(120000)})}))));
 }
 async function input(file:string):Promise<any>{
  if(file==='-')return readProtectedJsonFromStdin();
  try{return JSON.parse(await readFile(file,'utf8'));}catch{throw problem('cli.invalid_json','validation','无法读取有效JSON输入');}
 }
 const subject=()=>{const value=cli.opts().subject;if(!value)throw problem('cli.subject_required','validation','请提供 --subject');return value as string;};
 cli.command('init').option('--database-mode <mode>','external 或 managed').option('--database-port <port>','管理数据库端口',Number,55488).option('--database-url-env <variable>','数据库URL的环境变量名').option('--port <number>','HTTP端口',Number)
  .action(async opts=>{
   if(opts.databaseMode&&!['external','managed'].includes(opts.databaseMode))throw problem('cli.invalid_database_mode','validation','数据库模式必须为external或managed');
   const view=await bootstrap().init({...(opts.databaseMode==='managed'?{database:{mode:'managed',runtimeRef:postgresRuntimeRef(),port:opts.databasePort,database:'heptalogos',user:'hept',passwordRef:'database-password',maxConnections:10}}:{}),...(opts.port?{listen:{port:opts.port}}:{})}),secrets=createBootstrapSecrets(view.paths.secret);
   if(view.bootstrap.database.mode==='managed')await secrets.ensureFile(view.bootstrap.database.passwordRef,{purpose:'bootstrap.database'});
   if(view.bootstrap.database.mode==='external'&&opts.databaseUrlEnv&&!(await secrets.status(view.bootstrap.database.urlRef)).configured)
    await secrets.bindEnv(view.bootstrap.database.urlRef,{variable:opts.databaseUrlEnv,purpose:'bootstrap.database'});
   await secrets.ensureFile('auth-signing',{purpose:'auth.signing'});
   const databaseConfigured=view.bootstrap.database.mode==='external'?(await secrets.status(view.bootstrap.database.urlRef)).available:(await createPostgresRuntime(view).inspect()).state==='installed'&&(await secrets.status(view.bootstrap.database.passwordRef)).available;
   if(databaseConfigured){const {withHept}=await import('@heptalogos/server');await withHept(view,async()=>undefined);}
   print({installationId:view.bootstrap.installationId,configPath:view.configPath,paths:view.paths,databaseInitialized:databaseConfigured,next:'hept admin-create'});
  });
 const runtime=cli.command('runtime').description('显式取得和检查可选数据库运行时');
 runtime.command('acquire <name>').action(async name=>{if(name!=='postgres')throw problem('cli.runtime_unknown','validation','未知运行时');print(await createPostgresRuntime(await bootstrap().inspect()).acquire());});
 runtime.command('status <name>').action(async name=>{if(name!=='postgres')throw problem('cli.runtime_unknown','validation','未知运行时');print(await createPostgresRuntime(await bootstrap().inspect()).inspect());});
 const boot=cli.command('bootstrap').description('主服务离线时的引导管理');
 boot.command('inspect').action(async()=>print(await bootstrap().inspect()));
 boot.command('configure <file>').requiredOption('--expected-digest <digest>').action(async(file,opts)=>print(await bootstrap().configure({expectedDigest:opts.expectedDigest,changes:await input(file)})));
 boot.command('bind-env <ref> <variable>').requiredOption('--purpose <purpose>').action(async(ref,variable,opts)=>{const view=await bootstrap().inspect();print(await createBootstrapSecrets(view.paths.secret).bindEnv(ref,{variable,purpose:opts.purpose}));});
 cli.command('doctor').action(async()=>print(await bootstrap().doctor()));
 cli.command('admin-create').requiredOption('--email <email>').option('--password-env <variable>','初始密码的环境变量名').option('--password-stdin','从stdin读取初始密码')
  .action(async opts=>{
   const view=await bootstrap().inspect(),secrets=createBootstrapSecrets(view.paths.secret);
   const {withHept}=await import('@heptalogos/server');
   await withHept(view,async app=>{
    const create=async(password:string)=>{
     const user=await app.authentication.bootstrapAdministrator({email:opts.email,password,name:'Administrator'});
     const credential=await app.authentication.createManagementKey(user.userId,{name:'CLI administrator',scope:managementScope(view.bootstrap.installationId)});
     const value=Buffer.from(credential.key);
     try{await secrets.setFile('cli-auth',{value,purpose:'cli.authentication'});}finally{value.fill(0);}
     print({userId:user.userId,credentialId:credential.id,credentialRef:'cli-auth'});
    };
    if(opts.passwordEnv){await secrets.bindEnv('initial-administrator',{variable:opts.passwordEnv,purpose:'auth.bootstrap'});try{await secrets.withSecret('initial-administrator',{purpose:'auth.bootstrap'},value=>create(new TextDecoder().decode(value)));}finally{await secrets.revoke('initial-administrator');}}
    else {if(cli.opts().json&&!opts.passwordStdin)throw problem('cli.password_input_required','validation','机器模式请提供密码环境引用或 --password-stdin');await create(await readProtectedPassword(Boolean(opts.passwordStdin),'初始管理员密码'));}
   });
  });
 const recovery=cli.command('recovery').description('持有本机引导权限时的管理员恢复');
 recovery.command('reset-administrator').requiredOption('--email <email>').option('--password-env <variable>').option('--password-stdin').option('--unban')
  .action(async opts=>{const view=await bootstrap().inspect(),secrets=createBootstrapSecrets(view.paths.secret),{withHept}=await import('@heptalogos/server');await withHept(view,async app=>{const reset=async(password:string)=>print(await app.authentication.recovery.resetAdministrator({email:opts.email,password,unban:Boolean(opts.unban)}));if(opts.passwordEnv){await secrets.bindEnv('recovery-password',{variable:opts.passwordEnv,purpose:'auth.recovery'});try{await secrets.withSecret('recovery-password',{purpose:'auth.recovery'},bytes=>reset(new TextDecoder().decode(bytes)));}finally{await secrets.revoke('recovery-password');}}else{if(cli.opts().json&&!opts.passwordStdin)throw problem('cli.password_input_required','validation','机器模式请提供密码环境引用或 --password-stdin');await reset(await readProtectedPassword(Boolean(opts.passwordStdin),'新的管理员密码'));}});});
 cli.command('login').requiredOption('--email <email>').option('--password-env <variable>').option('--password-stdin')
  .action(async opts=>{
   const view=await bootstrap().inspect(),secrets=createBootstrapSecrets(view.paths.secret),baseURL=view.bootstrap.listen.publicBaseURL??`http://${view.bootstrap.listen.host}:${view.bootstrap.listen.port}`;
   const login=async(password:string)=>{
    let cookie:string|undefined;
    try{
     const response=await fetch(`${baseURL}/v1/auth/sign-in/email`,{method:'POST',headers:{'content-type':'application/json',origin:baseURL},body:JSON.stringify({email:opts.email,password})});
     if(!response.ok)throw problem('cli.login_failed','forbidden','登录失败');
     cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
     const key=await new sdk.CredentialsApi(new sdk.Configuration({basePath:baseURL,headers:{cookie,origin:baseURL},middleware:[sdk.problemMiddleware]})).credentialsCreateManagementKey({credentialsCreateManagementKeyRequest:{name:'CLI administrator'}}) as {id:string;key:string};const bytes=Buffer.from(key.key);
     try{await secrets.setFile('cli-auth',{value:bytes,purpose:'cli.authentication'});}finally{bytes.fill(0);}
     print({credentialId:key.id,credentialRef:'cli-auth'});
    }finally{if(cookie)await fetch(`${baseURL}/v1/auth/sign-out`,{method:'POST',headers:{cookie,origin:baseURL,'content-type':'application/json'},body:'{}'});}
   };
   if(opts.passwordEnv){await secrets.bindEnv('login-password',{variable:opts.passwordEnv,purpose:'auth.login'});try{await secrets.withSecret('login-password',{purpose:'auth.login'},value=>login(new TextDecoder().decode(value)));}finally{await secrets.revoke('login-password');}}
   else {if(cli.opts().json&&!opts.passwordStdin)throw problem('cli.password_input_required','validation','机器模式请提供密码环境引用或 --password-stdin');await login(await readProtectedPassword(Boolean(opts.passwordStdin),'管理员密码'));}
  });
 const host=cli.command('host').description('产品Host生命周期');
 host.command('start').action(async()=>{const {runHost}=await import('@heptalogos/server');await runHost({programRoot,configPath:cli.opts().config,instanceHome:cli.opts().instanceHome,onStarted:print});});
 host.command('status').action(async()=>print(await withClient(client=>client.host.hostStatus())));
 host.command('drain').action(async()=>print(await withClient(client=>client.host.hostDrain({hostDrainRequest:{}}))));
 host.command('stop').option('--force').action(async opts=>print(await withClient(client=>client.host.hostStop({hostStopRequest:{mode:opts.force?'force':'graceful'}}))));
 const service=cli.command('service').description('原生OS服务管理');
 for(const action of ['plan','install','start','stop','status','uninstall'] as const)
  service.command(action).option('--scope <scope>','user 或 system','user').option('--account <account>').option('--shawl <file>')
   .action(async opts=>{
    if(!['user','system'].includes(opts.scope))throw problem('cli.invalid_scope','validation','服务范围必须为user或system');
    const manager=createServiceManager({view:await bootstrap().inspect(),nodePath:process.execPath,entrypoint:fileURLToPath(import.meta.resolve('@heptalogos/server/run')),scope:opts.scope,account:opts.account,shawlPath:opts.shawl});
    print(await manager[action]());
   });
 const subjects=cli.command('subject');
 subjects.command('create <name>').option('--role <file>').action(async(name,opts)=>print(await withClient(async client=>client.subjects.subjectsCreate({subjectsCreateRequest:{displayName:name,clientSubmissionId:v7(),roleMaterial:opts.role?await readFile(opts.role,'utf8'):''}}))));
 subjects.command('list').action(async()=>print(await withClient(client=>client.subjects.subjectsList())));
 for(const action of ['start','pause','stop'] as const)subjects.command(action).action(async()=>print(await withClient(client=>client.subjects[action==='start'?'subjectsStart':action==='pause'?'subjectsPause':'subjectsStop']({subjectId:subject(),requestBody:{}}))));
 cli.command('chat <text>').option('--conversation <key>','会话','local:administrator').action(async(text,opts)=>print(await withClient(async client=>client.messages.messagesReceive({subjectId:subject(),messagesReceiveRequest:{clientSubmissionId:v7(),conversationKey:opts.conversation,channelAccount:'local',platformMessageId:v7(),authorId:(await client.identity.identityCurrent()).actor.id,parts:[{kind:'text',partId:v7(),text}],policy:{readers:['*'],purposes:['*'],audiences:[opts.conversation]}}}))));
 cli.command('inbox').action(async()=>print(await withClient(client=>client.conversations.conversationsList({subjectId:subject()}))));
 cli.command('conversation <id>').action(async id=>print(await withClient(client=>client.conversations.conversationsRead({subjectId:subject(),id}))));
 cli.command('why').action(async()=>print(await withClient(client=>client.agency.agencyExplainAttention({subjectId:subject()}))));
 cli.command('operation <id>').option('--wait').action(async(id,opts)=>print(await withClient(async client=>{const until=Date.now()+60000;for(;;){const operation=await client.operations.operationsInspect({id});if(!opts.wait||['completed','failed','cancelled'].includes(operation.status))return operation;if(Date.now()>=until)throw problem('cli.operation_pending','unavailable','操作仍在运行');await new Promise(resolve=>setTimeout(resolve,300));}})));
 const worlds=cli.command('world');
 for(const action of ['preview','create'] as const)worlds.command(`${action} <file>`).action(async file=>{const {loadWorldPackage}=await import('@heptalogos/hept/world-package');print(await withClient(async client=>client.worlds[action==='preview'?'worldsPreview':'worldsCreate']({subjectId:subject(),worldsPreviewRequest:await loadWorldPackage(file)})));});
 worlds.command('inspect').action(async()=>print(await withClient(client=>client.world.worldInspect({subjectId:subject()}))));
 const settings=cli.command('settings');
 const configScope=async(opts:{installation?:boolean;role?:string}):Promise<sdk.ConfigScopeInput>=>opts.installation?{kind:'installation',installationId:(await bootstrap().inspect()).bootstrap.installationId}:opts.role?{kind:'role',subjectId:subject(),roleId:opts.role}:{kind:'subject',subjectId:subject()};
 settings.command('get <namespace>').option('--installation').option('--role <id>').action(async(namespace,opts)=>print(await withClient(async client=>client.settings.settingsRead({namespaces:[namespace],scope:await configScope(opts)}))));
 settings.command('describe').option('--namespace <name>').action(async opts=>print(await withClient(client=>client.settings.settingsDescribe({namespace:opts.namespace}))));
 settings.command('update <file>').description('namespace、scope、expectedRevision 与 JSON Patch').action(async file=>print(await withClient(async client=>client.settings.settingsUpdate({settingsChangeInput:await input(file)}))));
 settings.command('reset <file>').action(async file=>print(await withClient(async client=>client.settings.settingsReset({settingsResetInput:await input(file)}))));
 settings.command('history <namespace>').option('--installation').option('--role <id>').action(async(namespace,opts)=>print(await withClient(async client=>client.settings.settingsHistory({namespace,scope:await configScope(opts)}))));
 settings.command('restore <file>').action(async file=>print(await withClient(async client=>client.settings.settingsRestore({settingsRestoreInput:await input(file)}))));
 const secret=cli.command('secret');
 secret.command('create <file>').description('从JSON文件或stdin登记用途、资源、Consumer和后端').action(async file=>print(await withClient(async client=>client.secrets.secretsCreate({secretsCreateRequest:await input(file)}))));
 secret.command('status <ref>').action(async id=>print(await withClient(client=>client.secrets.secretsStatus({id}))));
 secret.command('rotate <ref> <file>').action(async(id,file)=>print(await withClient(async client=>client.secrets.secretsRotate({id,secretsRotateRequest:await input(file)}))));
 secret.command('revoke <ref>').requiredOption('--expected-revision <number>','当前修订',Number).action(async(id,opts)=>print(await withClient(client=>client.secrets.secretsRevoke({id,secretsRevokeRequest:{expectedRevision:opts.expectedRevision}}))));
 const network=cli.command('network');
 network.command('list').action(async()=>print(await withClient(client=>client.network.networkInspect())));
 network.command('probe <file>').description('按已登记resourceRef的实际范围探测DNS/TLS/HTTP').action(async file=>print(await withClient(async client=>client.network.networkProbe({networkProbeRequest:await input(file)}))));
 const model=cli.command('model');
 model.command('create <file>').action(async file=>print(await withClient(async client=>client.models.modelsCreate({modelsCreateRequest:await input(file)}))));
 model.command('test <file>').action(async file=>print(await withClient(async client=>client.models.modelsTest({modelTestBodyInput:await input(file)}))));
 model.command('list').action(async()=>print(await withClient(client=>client.models.modelsList())));
 const provider=cli.command('provider');
 provider.command('create <file>').action(async file=>print(await withClient(async client=>client.providers.modelProvidersCreate({modelProvidersCreateRequest:await input(file)}))));
 provider.command('list').action(async()=>print(await withClient(client=>client.providers.modelProvidersList())));
 model.command('roles').action(async()=>print(await withClient(client=>client.models.modelsDescribeRoles())));
 const task=cli.command('task');
 task.command('start <goal>').action(async goal=>print(await withClient(client=>client.tasks.tasksStart({subjectId:subject(),tasksStartRequest:{clientSubmissionId:v7(),goal,inputRefs:[],allowedTools:[],returnTarget:{}}}))));
 task.command('inspect <id>').action(async id=>print(await withClient(client=>client.tasks.tasksInspect({subjectId:subject(),id}))));
 for(const action of ['pause','cancel'] as const)task.command(`${action} <id>`).action(async id=>print(await withClient(client=>action==='pause'?client.tasks.tasksPause({subjectId:subject(),id,body:{}}):client.tasks.tasksCancel({subjectId:subject(),id,body:{}}))));
 task.command('recovery-plan <id>').option('--invocation-id <id>','原模型调用ID').action(async(id,opts)=>print(await withClient(client=>client.tasks.tasksPlanRecovery({subjectId:subject(),id,heptTaskRecoveryPlanInputInput:{invocationId:opts.invocationId}}))));
 task.command('resume <id>').description('沿原生计划恢复同一Task、run与session').requiredOption('--expected-revision <number>','当前Task修订',Number).option('--invocation-id <id>','原模型调用ID').option('--submission-id <id>').action(async(id,opts)=>print(await withClient(client=>client.tasks.tasksResume({subjectId:subject(),id,heptTaskRecoveryInput:{expectedRevision:opts.expectedRevision,invocationId:opts.invocationId}}),{submissionId:opts.submissionId??v7()})));
 task.command('continue <id>').description('明确创建新Task与原生run').requiredOption('--expected-revision <number>','当前Task修订',Number).option('--goal <text>').option('--submission-id <id>').action(async(id,opts)=>print(await withClient(client=>client.tasks.tasksCreateContinuation({subjectId:subject(),id,heptTaskContinuationInput:{expectedRevision:opts.expectedRevision,goal:opts.goal}}),{submissionId:opts.submissionId??v7()})));

 const invocations=model.command('invocations');
 invocations.command('list').option('--installation').action(async opts=>print(await withClient(client=>client.models.modelsListInvocations({subjectId:opts.installation?undefined:subject()}))));
 invocations.command('read <id>').option('--installation').action(async(id,opts)=>print(await withClient(client=>client.models.modelsInspectInvocation({id,subjectId:opts.installation?undefined:subject()}))));
 invocations.command('reconcile <file>').action(async file=>print(await withClient(async client=>client.models.modelsReconcile({modelsReconcileRequest:await input(file)}))));
 const time=cli.command('time').description('时间authority与时钟修订');
 for(const name of ['read','capture','bind','references'] as const)time.command(`${name} <file>`).option('--submission-id <id>').action(async(file,opts)=>{const value=await input(file);print(await withClient(client=>name==='read'?client.clock.clockRead({timeSelectionInput:value}):name==='capture'?client.clock.clockCapture({timeCaptureBodyInput:value}):name==='bind'?client.time.timeBindingsUpdate({timeBindingsUpdateRequest:value}):client.clock.clockReferencesRead({clockReferencesReadRequest:value}),{submissionId:opts.submissionId??v7()}));});
 const domains=time.command('domain');
 domains.command('create <file>').option('--submission-id <id>').action(async(file,opts)=>print(await withClient(async client=>client.time.timeDomainsCreate({timeDomainCreateRequestInput:await input(file)}),{submissionId:opts.submissionId??v7()})));
 domains.command('read <id>').action(async id=>print(await withClient(client=>client.time.timeDomainsRead({id,subjectId:cli.opts().subject}))));
 const clock=time.command('clock');
 clock.command('configure <file>').option('--submission-id <id>').action(async(file,opts)=>print(await withClient(async client=>client.clock.clockConfigure({clockConfigureRequestInput:await input(file)}),{submissionId:opts.submissionId??v7()})));
 clock.command('inspect <id>').action(async id=>print(await withClient(client=>client.clock.clockInspect({id,subjectId:cli.opts().subject}))));
 clock.command('history <id>').option('--after-revision <revision>','修订游标',Number).option('--revision <revision>','固定历史上界',Number).action(async(id,opts)=>print(await withClient(client=>client.clock.clockHistory({id,subjectId:cli.opts().subject,afterRevision:opts.afterRevision,revision:opts.revision}))));
 for(const action of ['pause','resume','advance'] as const)clock.command(`${action} <file>`).option('--submission-id <id>').action(async(file,opts)=>{const value=await input(file);print(await withClient(client=>action==='pause'?client.clock.clockPause({id:value.clockRef.id,clockPauseRequestInput:value}):action==='resume'?client.clock.clockResume({id:value.clockRef.id,clockResumeRequestInput:value}):client.clock.clockAdvance({id:value.clockRef.id,clockAdvanceRequestInput:value}),{submissionId:opts.submissionId??v7()}));});
 time.command('project-deadline <snapshot> <point>').action(async(snapshot,point)=>{const {ClockSnapshotSchema}=await import('@nous-wave/contracts/time');const {TimePointInputSchema}=await import('@nous-wave/contracts/common');const {projectDeadline}=await import('@nous-wave/platform/time');print(projectDeadline(ClockSnapshotSchema.parse(await input(snapshot)),TimePointInputSchema.parse(await input(point))));});
 const data=cli.command('data').description('主体资料导出与同身份恢复');
 data.command('export <file>').action(async file=>{await withClient(async client=>{const response=await client.data.dataExportRaw({subjectId:subject()}),body=response.raw.body;if(!body)throw problem('cli.empty_export','unavailable','导出响应缺少资料流');const output=createWriteStream(file,{flags:'wx',mode:0o600});let created=false;output.once('open',()=>{created=true;});try{await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>),output);print({path:file,bytes:output.bytesWritten});}catch(error){if(created)await rm(file,{force:true});throw error;}});});
 for(const action of ['preview','import'] as const)data.command(`${action} <file>`).option('--submission-id <id>').action(async(file,opts)=>{if((await stat(file)).size>60*1024*1024)throw problem('cli.package_too_large','validation','压缩包超过60MiB');print(await withClient(async client=>{const request={body:Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>},overrides:import('@heptalogos/client').InitOverrideFunction=async({init})=>({...init,duplex:'half' as const});const response=action==='preview'?await client.data.dataPreviewImportRaw(request,overrides):await client.data.dataImportRaw(request,overrides);return response.raw.json();},{submissionId:opts.submissionId??v7()}));});
 data.command('purge').action(async()=>print(await withClient(client=>client.data.dataPurge({subjectId:subject(),body:{}}))));
 cli.command('costs').option('--installation').action(async opts=>print(await withClient(client=>client.costs.costsRead({subjectId:opts.installation?undefined:subject()}))));
 return cli;
}
