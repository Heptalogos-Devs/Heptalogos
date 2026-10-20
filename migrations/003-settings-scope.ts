import { sql,type Kysely } from 'kysely';
export async function up(db:Kysely<any>){await sql`create unique index if not exists settings_override_scope on settings_overrides (subject_id)`.execute(db);}
