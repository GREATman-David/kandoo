/**
 * Seed the DEMO account with a believable slice of one person's life — work,
 * family, health and errands — spread across the last six weeks with backdated
 * `created_at`, so recall has real history and, crucially, memories OLDER than
 * 7 days for the Pro paywall boundary to gate.
 *
 * SAFETY: this writes real rows with the service-role key (RLS bypassed), so it
 * refuses to run against anything but the demo account. You must pass BOTH
 * DEMO_USER_ID and DEMO_USER_EMAIL, and they must match the same Supabase user —
 * a wrong id can't slip through, and it can never touch a random/production
 * account. Every row is tagged via a `source: 'seed'` capture, so re-running
 * clears the previous seed instead of piling up.
 *
 *   DEMO_USER_ID=... DEMO_USER_EMAIL=... npm run seed:demo
 */
import 'dotenv/config';

import { aiProvider } from '../src/modules/ai';
import { supabase } from '../src/services/supabase';

const TIMEZONE = 'Africa/Lagos';

type MemorySeed = {
  kind: 'memory';
  daysAgo: number;
  hour: number;
  content: string;
  person?: string;
  location?: string;
  topics: string[];
};

type ReminderSeed = {
  kind: 'reminder';
  daysAgo: number;
  hour: number;
  task: string;
  person?: string;
  place?: string;
  dueHour: number;
  status: 'fired' | 'confirmed' | 'pending';
  insistent?: boolean;
};

type Seed = MemorySeed | ReminderSeed;

/**
 * ~20 items. Several pairs deliberately straddle the 7-day line on the same
 * theme (health, work) so the demo can show recent answers free and older ones
 * gated. `daysAgo` > 7 is where the paywall has something to sell.
 */
const SEED: Seed[] = [
  // --- Work ---
  { kind: 'memory', daysAgo: 33, hour: 11, content: 'The budget for the platform team got cut by fifteen percent this year.', topics: ['work', 'budget'] },
  { kind: 'memory', daysAgo: 21, hour: 15, content: 'Priya owns the vendor migration now, not me.', person: 'Priya', topics: ['work', 'ownership'] },
  { kind: 'memory', daysAgo: 12, hour: 9, content: 'Standup moved to 9:30 so the New York team can join.', topics: ['work', 'schedule'] },
  { kind: 'memory', daysAgo: 4, hour: 17, content: 'The Q1 roadmap review is the first week of February.', topics: ['work', 'roadmap'] },
  { kind: 'reminder', daysAgo: 26, hour: 10, task: 'Send Michael the design spec', person: 'Michael', dueHour: 17, status: 'fired' },
  { kind: 'reminder', daysAgo: 3, hour: 8, task: 'Book the review room for the retro', place: 'the office', dueHour: 9, status: 'confirmed' },

  // --- Family ---
  { kind: 'memory', daysAgo: 29, hour: 20, content: "Mum's birthday dinner is booked at the Italian place on the 14th.", person: 'Mum', location: 'the Italian place', topics: ['family', 'birthday'] },
  { kind: 'memory', daysAgo: 18, hour: 19, content: 'My sister Ada is visiting the last weekend of the month.', person: 'Ada', topics: ['family', 'visit'] },
  { kind: 'memory', daysAgo: 9, hour: 21, content: 'Dad moved his heart tablets to the morning after the checkup.', person: 'Dad', topics: ['family', 'health'] },
  { kind: 'memory', daysAgo: 2, hour: 18, content: 'Ada wants to go to the pottery class together when she visits.', person: 'Ada', topics: ['family', 'plans'] },
  { kind: 'reminder', daysAgo: 5, hour: 16, task: 'Call Mummy', person: 'Mummy', dueHour: 17, status: 'fired', insistent: false },

  // --- Health ---
  { kind: 'memory', daysAgo: 25, hour: 14, content: 'Dr. Okafor said my vitamin D was low and to retest in three months.', person: 'Dr. Okafor', location: 'the clinic', topics: ['health', 'bloodwork'] },
  { kind: 'memory', daysAgo: 16, hour: 8, content: 'Physio gave me the resistance-band routine for my left shoulder.', topics: ['health', 'physio'] },
  { kind: 'memory', daysAgo: 6, hour: 7, content: 'Switched to the 7am gym slot because it is quieter.', location: 'the gym', topics: ['health', 'routine'] },
  { kind: 'reminder', daysAgo: 6, hour: 9, task: 'Take the antibiotics with food for a week', dueHour: 20, status: 'fired', insistent: true },

  // --- Errands / life ---
  { kind: 'memory', daysAgo: 38, hour: 13, content: "The car's next service is due at 45,000 km.", topics: ['car', 'maintenance'] },
  { kind: 'memory', daysAgo: 20, hour: 12, content: 'Left the grey coat at the dry cleaner on Adeola street.', location: 'Adeola street', topics: ['errands', 'dry cleaning'] },
  { kind: 'memory', daysAgo: 3, hour: 13, content: "Found a good jollof spot near the office — Mama Nkechi's.", location: "Mama Nkechi's", topics: ['food', 'lunch'] },
  { kind: 'reminder', daysAgo: 19, hour: 12, task: 'Pick up the grey coat from the dry cleaner', place: 'Adeola street', dueHour: 18, status: 'fired' },
  { kind: 'reminder', daysAgo: 1, hour: 9, task: 'Pay the electricity bill', dueHour: 21, status: 'confirmed', insistent: true },
];

/**
 * Substantial spoken recaps, run through the REAL extraction so their notes are
 * genuine (organised, nothing invented) rather than hand-written — and so each
 * populates the Memory tab with a note plus the memories/reminders it produced.
 * Spread across the six weeks; two land older than a week.
 */
const RECAPS: { daysAgo: number; hour: number; text: string }[] = [
  {
    // The Jed standup, so People's Jed matches the design frame: three memories
    // clearly attributed to Jed, one Jed reminder, and one note.
    daysAgo: 0,
    hour: 9,
    text:
      'Just came out of the standup with Jed. First, Jed is pushing the API ' +
      'migration to Q1 because of the vendor issue. Second, Jed is taking two ' +
      'weeks off in December for the holidays. Third, Jed prefers we review the ' +
      'spec together before it goes out to the client. Remind me to send Jed ' +
      'the revised timeline on Friday morning.',
  },
  {
    daysAgo: 34,
    hour: 16,
    text:
      "Just wrapped the sprint review. We're cutting the analytics dashboard " +
      "from this release because QA found a data race we can't fix in time. " +
      'Tunde is taking over the vendor contract renewal, and finance wants the ' +
      'revised budget by Friday. I need to send the board the updated timeline ' +
      'before end of day, and set a reminder to prep the demo script next week.',
  },
  {
    daysAgo: 20,
    hour: 19,
    text:
      "Had a long call with Mum about Dad's checkup. His blood pressure is down " +
      'and the doctor is happy, but they want him off salt and walking every ' +
      "day. Ada confirmed she's coming for Christmas and bringing the kids, so " +
      'the spare room needs sorting. Remind me to order Dad the new blood ' +
      "pressure monitor, and to call the doctor's office about his next appointment.",
  },
  {
    daysAgo: 5,
    hour: 18,
    text:
      'Got a lot done today. The plumber fixed the kitchen leak and said the ' +
      'pipes under the sink need replacing within the year. I picked up the dry ' +
      'cleaning and dropped the tax documents with the accountant. I still need ' +
      'to renew the car insurance before it lapses next week, and book the ' +
      'dentist for that filling.',
  },
];

function backdate(daysAgo: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, Math.floor(Math.random() * 50), 0, 0);
  return date.toISOString();
}

async function assertDemoAccount(): Promise<string> {
  const id = process.env.DEMO_USER_ID;
  const email = process.env.DEMO_USER_EMAIL;

  if (!id || !email) {
    throw new Error(
      'Refusing to run: set BOTH DEMO_USER_ID and DEMO_USER_EMAIL to the demo ' +
        'account. This script writes real rows with the service-role key.'
    );
  }

  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || !data?.user) {
    throw new Error(`No Supabase user found for DEMO_USER_ID ${id}.`);
  }

  const actual = (data.user.email ?? '').toLowerCase();
  if (actual !== email.toLowerCase()) {
    throw new Error(
      `DEMO_USER_ID does not belong to DEMO_USER_EMAIL (id is ${actual || 'no email'}). ` +
        'Aborting so this can never seed the wrong account.'
    );
  }

  return id;
}

async function clearPreviousSeed(userId: string): Promise<void> {
  const { data: caps } = await supabase
    .from('captures')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'seed');

  const capIds = (caps ?? []).map((c: { id: string }) => c.id);
  if (capIds.length === 0) return;

  // Children first — seed memories/reminders carry no entity links, so there is
  // nothing in memory_entities to block the delete.
  await supabase.from('memories').delete().eq('user_id', userId).in('capture_id', capIds);
  await supabase.from('reminders').delete().eq('user_id', userId).in('capture_id', capIds);
  await supabase.from('captures').delete().eq('user_id', userId).eq('source', 'seed');
  console.log(`Cleared ${capIds.length} previous seed captures.`);
}

async function insertItem(
  userId: string,
  item: Seed
): Promise<{ table: 'memories' | 'reminders'; id: string; text: string }> {
  const createdAt = backdate(item.daysAgo, item.hour);
  const text = item.kind === 'memory' ? item.content : item.task;

  const { data: capture, error: capErr } = await supabase
    .from('captures')
    .insert({
      user_id: userId,
      text,
      client_time: createdAt,
      timezone: 'Africa/Lagos',
      source: 'seed',
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (capErr || !capture) throw new Error(`Capture insert failed: ${capErr?.message}`);

  if (item.kind === 'memory') {
    const { data, error } = await supabase
      .from('memories')
      .insert({
        user_id: userId,
        capture_id: capture.id,
        content: item.content,
        person: item.person ?? null,
        location: item.location ?? null,
        topics: item.topics,
        embedding: null,
        created_at: createdAt,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`Memory insert failed: ${error?.message}`);
    return { table: 'memories', id: data.id, text: item.content };
  }

  const dueAt = backdate(item.daysAgo, item.dueHour);
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      capture_id: capture.id,
      task: item.task,
      person: item.person ?? null,
      due_at: dueAt,
      reminder_time: dueAt,
      place_hint: item.place ?? null,
      place_id: null,
      insistent: item.insistent ?? false,
      status: item.status,
      embedding: null,
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Reminder insert failed: ${error?.message}`);
  return { table: 'reminders', id: data.id, text: item.task };
}

async function insertRecap(
  userId: string,
  recap: { daysAgo: number; hour: number; text: string }
): Promise<{ table: 'memories' | 'reminders'; id: string; text: string }[]> {
  const createdAt = backdate(recap.daysAgo, recap.hour);

  // Real extraction, resolving any relative times against the backdated moment
  // so "next week" / "before end of day" land in the right place in history.
  const result = await aiProvider.interpret(recap.text, {
    clientTime: createdAt,
    timezone: TIMEZONE,
  });

  const { data: capture, error: capErr } = await supabase
    .from('captures')
    .insert({
      user_id: userId,
      text: recap.text,
      client_time: createdAt,
      timezone: TIMEZONE,
      source: 'seed',
      note: result.note,
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (capErr || !capture) throw new Error(`Recap capture insert failed: ${capErr?.message}`);

  const rows: { table: 'memories' | 'reminders'; id: string; text: string }[] = [];

  for (const action of result.actions) {
    if (action.kind === 'memory') {
      const { data, error } = await supabase
        .from('memories')
        .insert({
          user_id: userId,
          capture_id: capture.id,
          content: action.content,
          person: action.people[0] ?? null,
          location: action.placeHint,
          topics: action.topics,
          embedding: null,
          created_at: createdAt,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Recap memory insert failed: ${error?.message}`);
      rows.push({ table: 'memories', id: data.id, text: action.content });
    } else if (action.kind === 'reminder') {
      const past = action.dueAt ? Date.parse(action.dueAt) < Date.now() : true;
      const { data, error } = await supabase
        .from('reminders')
        .insert({
          user_id: userId,
          capture_id: capture.id,
          task: action.task,
          person: action.people[0] ?? null,
          due_at: action.dueAt,
          // Legacy column is NOT NULL; a place-anchored reminder has no dueAt,
          // so fall back to the capture time.
          reminder_time: action.dueAt ?? createdAt,
          place_hint: action.placeHint,
          place_id: null,
          insistent: action.insistent,
          status: past ? 'fired' : 'confirmed',
          embedding: null,
          created_at: createdAt,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`Recap reminder insert failed: ${error?.message}`);
      rows.push({ table: 'reminders', id: data.id, text: action.task });
    }
    // A recall action would be odd inside a recap; ignore it if one appears.
  }

  console.log(
    `  recap ${recap.daysAgo}d ago → note ${
      result.note ? `"${result.note.title}"` : 'null'
    }, ${rows.length} linked items`
  );
  return rows;
}

async function embedAll(
  rows: { table: 'memories' | 'reminders'; id: string; text: string }[]
): Promise<void> {
  // One batched embed call for the whole set — cheap against the daily quota,
  // and recall's hybrid search needs the vectors to match semantically.
  let vectors: number[][];
  try {
    vectors = await aiProvider.embed(
      rows.map((r) => r.text),
      'document'
    );
  } catch (error) {
    console.warn(
      'Embedding failed; rows are seeded but vectorless (lexical recall still ' +
        'works, and backfill can fill these in later):',
      error
    );
    return;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { error } = await supabase
      .from(row.table)
      .update({ embedding: vectors[i] })
      .eq('id', row.id);
    if (error) console.error(`Embedding update failed for ${row.table} ${row.id}:`, error);
  }
  console.log(`Embedded ${rows.length} rows.`);
}

async function main() {
  const userId = await assertDemoAccount();
  console.log(`Seeding demo account ${userId} (${process.env.DEMO_USER_EMAIL}).`);

  await clearPreviousSeed(userId);

  const rows: { table: 'memories' | 'reminders'; id: string; text: string }[] = [];
  for (const item of SEED) {
    rows.push(await insertItem(userId, item));
  }

  console.log(`Extracting ${RECAPS.length} recaps for genuine notes…`);
  for (const recap of RECAPS) {
    try {
      rows.push(...(await insertRecap(userId, recap)));
    } catch (error) {
      // A transient Gemini 503/quota on one recap must not sink the whole seed
      // — the other recaps and all the direct facts still go in.
      console.warn(
        `  recap ${recap.daysAgo}d skipped:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const memories = rows.filter((r) => r.table === 'memories').length;
  const reminders = rows.filter((r) => r.table === 'reminders').length;
  const older =
    SEED.filter((s) => s.daysAgo > 7).length +
    RECAPS.filter((r) => r.daysAgo > 7).length;
  console.log(
    `Inserted ${memories} memories and ${reminders} reminders across ` +
      `${SEED.length} facts + ${RECAPS.length} recaps ` +
      `(${older} captures older than 7 days — the paywall boundary).`
  );

  await embedAll(rows);
  console.log('Demo seed complete.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
