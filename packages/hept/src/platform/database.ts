import * as settingsScope from '../../../../migrations/003-settings-scope.js';
import * as sourceIndexes from '../../../../migrations/002-source-indexes.js';
import { createRequire } from 'node:module';
import { Migrator } from 'kysely/migration';
import { Kysely, PostgresDialect, CamelCasePlugin, type Generated, type ColumnType } from 'kysely';
import pg from 'pg';
import * as initial from '../../../../migrations/001-initial.js';
export type Json=Record<string,unknown>;
export interface RecordRow { id:string;subjectId:string;revision:number;document:Json;createdAt:ColumnType<Date,string,never>;updatedAt:ColumnType<Date,string,string>; }
export interface Database {
 media:RecordRow; subjects:RecordRow; subjectBindings:RecordRow; conversations:RecordRow; messages:RecordRow; messageRevisions:RecordRow;
 expressions:RecordRow; deliveryParts:RecordRow; statements:RecordRow; channels:RecordRow; people:RecordRow;
 worldClockSegments:RecordRow; worlds:RecordRow; calendarRules:RecordRow; calendarExceptions:RecordRow; realizedEvents:RecordRow;
 activities:RecordRow; lifeState:RecordRow; pursuits:RecordRow; commitments:RecordRow; decisions:RecordRow; opportunities:RecordRow; nextNodes:RecordRow;
 tasks:RecordRow; workspaces:RecordRow; settingsOverrides:RecordRow; settingsHistory:RecordRow; modelInvocations:RecordRow; modelResources:RecordRow;
 subjectChanges:{cursor:Generated<string>;subjectId:string;changedRefs:Json;recordedAt:ColumnType<Date,string,never>};
 requestKeys:{key:string;subjectId:string;digest:string;result:unknown};
}
export async function connect(databaseURL:string){
 const {Kysely:KyselyConstructor}=createRequire(import.meta.url)('kysely') as {Kysely:typeof Kysely};
 const db=new KyselyConstructor<Database>({dialect:new PostgresDialect({pool:new pg.Pool({connectionString:databaseURL,max:10})}),plugins:[new CamelCasePlugin({maintainNestedObjectKeys:true})]});
 const result=await new Migrator({db,provider:{getMigrations:async()=>({'001-initial':initial,'002-source-indexes':sourceIndexes,'003-settings-scope':settingsScope})}}).migrateToLatest();
 if(result.error)throw result.error;
 return db;
}
export const tables=['media','subjects','subjectBindings','conversations','messages','messageRevisions','expressions','deliveryParts','statements','channels','people','worlds','worldClockSegments','calendarRules','calendarExceptions','realizedEvents','activities','lifeState','pursuits','commitments','decisions','opportunities','nextNodes','tasks','workspaces','settingsOverrides','settingsHistory','modelInvocations','modelResources'] as const;
export type Table=typeof tables[number];
