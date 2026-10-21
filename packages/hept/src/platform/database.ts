import {modelMigration,type ModelsDatabase} from '@nous-wave/platform/models';
import {promptsMigration,type PromptDatabase} from '@nous-wave/platform/prompts';
import {timeMigration,type TimeDatabase} from '../time/index.js';
import {settingsMigration,settingsOriginMigration,type SettingsDatabase} from '@nous-wave/platform/settings';
import {secretMigration,type SecretDatabase} from '@nous-wave/platform/credentials';
import {delegationMigration,type DelegationDatabase} from '@nous-wave/platform/credentials';
import * as sourceIndexes from '../../migrations/002-source-indexes.js';
import type { Generated,ColumnType } from 'kysely';
import type { MigrationProvider } from 'kysely/migration';
import * as initial from '../../migrations/001-initial.js';
export type Json=Record<string,unknown>;
export interface RecordRow { id:string;subjectId:string;revision:number;document:Json;createdAt:ColumnType<string,string,never>;updatedAt:ColumnType<string,string,string>; }
export interface Database extends DelegationDatabase,SettingsDatabase,SecretDatabase,TimeDatabase,ModelsDatabase,PromptDatabase {
 modelArtifacts:RecordRow; media:RecordRow; subjects:RecordRow; subjectBindings:RecordRow; conversations:RecordRow; messages:RecordRow; messageRevisions:RecordRow;
 expressions:RecordRow; deliveryParts:RecordRow; statements:RecordRow; channels:RecordRow; people:RecordRow;
  worlds:RecordRow; calendarRules:RecordRow; calendarExceptions:RecordRow; realizedEvents:RecordRow;
 activities:RecordRow; lifeState:RecordRow; pursuits:RecordRow; commitments:RecordRow; decisions:RecordRow; opportunities:RecordRow; nextNodes:RecordRow;
 tasks:RecordRow; workspaces:RecordRow; 
 subjectChanges:{cursor:Generated<string>;subjectId:string;changedRefs:Json;recordedAt:ColumnType<string,string,never>};
 requestKeys:{key:string;subjectId:string;digest:string;result:unknown};
}
export const migrationProvider:MigrationProvider={getMigrations:async()=>({'001-initial':initial,'002-source-indexes':sourceIndexes,'004-delegations':delegationMigration,'005-shared-settings':settingsMigration,'006-settings-origin':settingsOriginMigration,'007-secrets':secretMigration,'008-time':timeMigration,'009-models':modelMigration,'010-prompts':promptsMigration})};
export const tables=['modelArtifacts','media','subjects','subjectBindings','conversations','messages','messageRevisions','expressions','deliveryParts','statements','channels','people','worlds','calendarRules','calendarExceptions','realizedEvents','activities','lifeState','pursuits','commitments','decisions','opportunities','nextNodes','tasks','workspaces'] as const;
export type Table=typeof tables[number];
