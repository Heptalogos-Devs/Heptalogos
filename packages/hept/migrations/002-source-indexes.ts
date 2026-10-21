import { sql,type Kysely } from 'kysely';
export async function up(db:Kysely<any>){
 await sql`create unique index conversations_source on conversations (subject_id,(document->>'channelAccount'),(document->>'key'))`.execute(db);
 await sql`create index people_account_source on people (subject_id,(document->>'accountKey'))`.execute(db);
 await sql`create index media_source on media (subject_id,(document->>'uploadKey'))`.execute(db);
}
