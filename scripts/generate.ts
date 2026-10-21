import {resolve} from 'node:path';
import {generateOpenApiClient} from '@nous-wave/platform/devtools/openapi';
import {createHttp} from '../apps/server/src/http.js';
const server=await createHttp();
try{await generateOpenApiClient({document:server.swagger(),schemaPath:resolve('packages/contracts/openapi/hept.json'),clientPath:resolve('packages/client/src/generated'),temporaryRoot:resolve('../temp/generated')});}
finally{await server.close();}
