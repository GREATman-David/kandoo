/**
 * Backfill person links from the legacy `person` text column, so rows created
 * before the entity links existed (or seeded directly) still appear under a
 * person and move on a merge:
 *   - memories  -> memory_entities   (memory_entities already exists)
 *   - reminders -> reminder_entities (needs migration 004; soft-skips otherwise)
 *
 * Idempotent — the link upserts ignore duplicates. Run once:
 *   npm run backfill:person-links
 */
import 'dotenv/config';

import {
  linkMemoryToEntities,
  linkReminderToEntities,
  resolveEntity,
} from '../src/modules/entities/entityService';
import { supabase } from '../src/services/supabase';

async function backfillMemories(): Promise<number> {
  const { data, error } = await supabase
    .from('memories')
    .select('id, user_id, person')
    .not('person', 'is', null)
    .limit(3000);
  if (error) {
    console.error('Memory backfill query failed:', error);
    return 0;
  }
  let linked = 0;
  for (const row of data ?? []) {
    const person = (row.person as string | null)?.trim();
    if (!person) continue;
    const entity = await resolveEntity(row.user_id as string, 'person', person);
    if (entity) {
      await linkMemoryToEntities(row.id as string, [entity.id]);
      linked++;
    }
  }
  return linked;
}

async function backfillReminders(): Promise<number> {
  const { data, error } = await supabase
    .from('reminders')
    .select('id, user_id, person')
    .not('person', 'is', null)
    .limit(3000);
  if (error) {
    console.error('Reminder backfill query failed:', error);
    return 0;
  }
  let linked = 0;
  for (const row of data ?? []) {
    const person = (row.person as string | null)?.trim();
    if (!person) continue;
    const entity = await resolveEntity(row.user_id as string, 'person', person);
    if (entity) {
      await linkReminderToEntities(row.id as string, [entity.id]);
      linked++;
    }
  }
  return linked;
}

async function main() {
  const memories = await backfillMemories();
  const reminders = await backfillReminders();
  console.log(`Linked ${memories} memories and ${reminders} reminders to people.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
