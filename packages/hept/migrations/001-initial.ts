import { sql, type Kysely } from 'kysely';
export async function up(db:Kysely<any>){
 for(const table of ['modelArtifacts','media','subjects','subjectBindings','conversations','messages','messageRevisions','expressions','deliveryParts','statements','channels','people','worlds','calendarRules','calendarExceptions','realizedEvents','activities','lifeState','pursuits','commitments','decisions','opportunities','nextNodes','tasks','workspaces']){
  await db.schema.createTable(table).addColumn('id','text',c=>c.primaryKey()).addColumn('subjectId','text',c=>c.notNull()).addColumn('revision','integer',c=>c.notNull().defaultTo(1)).addColumn('document','jsonb',c=>c.notNull()).addColumn('createdAt','timestamptz',c=>c.notNull().defaultTo(sql`now()`)).addColumn('updatedAt','timestamptz',c=>c.notNull().defaultTo(sql`now()`)).execute();
  await db.schema.createIndex(`${table}_subject`).on(table).column('subjectId').execute();
 }
 await sql`create unique index messages_source on messages (subject_id,(document->>'channelAccount'),(document->>'conversationKey'),(document->>'platformMessageId'))`.execute(db);
 await sql`create index messages_conversation_time on messages (subject_id,(document->>'conversationId'),(document->>'receivedAt'))`.execute(db);
 await db.schema.createTable('subjectChanges').addColumn('cursor','bigserial',c=>c.primaryKey()).addColumn('subjectId','text',c=>c.notNull()).addColumn('changedRefs','jsonb',c=>c.notNull()).addColumn('recordedAt','timestamptz',c=>c.notNull().defaultTo(sql`now()`)).execute();
 await db.schema.createIndex('changes_subject_cursor').on('subjectChanges').columns(['subjectId','cursor']).execute();
 await db.schema.createTable('requestKeys').addColumn('subjectId','text',c=>c.notNull()).addColumn('key','text',c=>c.primaryKey()).addColumn('digest','text',c=>c.notNull()).addColumn('result','jsonb',c=>c.notNull()).execute();
}
export async function down(db:Kysely<any>){throw new Error('Initial product migration is not reversible; restore a product backup.');}
