/**
 * Seed the DEMO account with a believable slice of one person's life in Accra —
 * product work at a fintech, family, health and errands — spread across the
 * last seven weeks with backdated `created_at`, so recall has real history and,
 * crucially, memories OLDER than 10 days for the Pro paywall to gate (the app's
 * free window is `TEN_DAYS_MS` in src/app/memory.tsx).
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
import {
  type EntityKind,
  linkMemoryToEntities,
  linkReminderToEntities,
  resolveEntities,
} from '../src/modules/entities/entityService';
import { supabase } from '../src/services/supabase';

const TIMEZONE = 'Africa/Accra';

/** The free window in the app. Anything older is locked on Free. */
const FREE_DAYS = 10;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

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
  /** Weekdays it repeats on, 0 = Sunday. */
  repeatDays?: number[];
};

type Seed = MemorySeed | ReminderSeed;

/**
 * Hand-written facts and reminders. Several themes straddle the 10-day line on
 * purpose (the Momo launch, family health, the car) so the demo can show recent
 * answers free and older ones locked. A negative `daysAgo` is a reminder still
 * to come: `confirmed` ones are scheduled on the phone after sign-in.
 */
const SEED: Seed[] = [
  // --- Work: product lead at a fintech in Airport City ---
  { kind: 'memory', daysAgo: 44, hour: 10, content: 'The Momo wallet integration has to pass the Bank of Ghana sandbox review before any public launch.', topics: ['work', 'compliance'] },
  { kind: 'memory', daysAgo: 36, hour: 15, content: 'Sarah from the London office owns the investor update deck every quarter.', person: 'Sarah', topics: ['work', 'investors'] },
  { kind: 'memory', daysAgo: 27, hour: 11, content: 'Kofi prefers bug reports with a screen recording, not screenshots.', person: 'Kofi', topics: ['work', 'engineering'] },
  { kind: 'memory', daysAgo: 22, hour: 16, content: 'Merchant onboarding drop-off is worst at the Ghana Card verification step, about forty percent.', topics: ['work', 'metrics'] },
  { kind: 'memory', daysAgo: 13, hour: 9, content: 'Ama Owusu from legal signs off on every change to the terms of service.', person: 'Ama Owusu', topics: ['work', 'legal'] },
  { kind: 'memory', daysAgo: 6, hour: 14, content: 'Daniel agreed to move the design review to Thursdays at 2pm.', person: 'Daniel', topics: ['work', 'schedule'] },
  { kind: 'memory', daysAgo: 2, hour: 17, content: 'The Q4 target is 5,000 active merchants by the end of December.', topics: ['work', 'targets'] },
  { kind: 'reminder', daysAgo: 31, hour: 9, task: 'Send Sarah the Q3 merchant numbers for the investor deck', person: 'Sarah', dueHour: 16, status: 'fired' },
  { kind: 'reminder', daysAgo: 4, hour: 8, task: 'Review the Ghana Card verification redesign with Daniel', person: 'Daniel', dueHour: 14, status: 'fired' },
  { kind: 'reminder', daysAgo: -1, hour: 10, task: 'Send Ama Owusu the updated terms for sign-off', person: 'Ama Owusu', dueHour: 11, status: 'confirmed' },
  { kind: 'reminder', daysAgo: -1, hour: 8, task: 'Post the standup notes in the team channel', dueHour: 9, status: 'confirmed', repeatDays: WEEKDAYS },

  // --- Family ---
  { kind: 'memory', daysAgo: 40, hour: 20, content: "Mum's blood pressure tablets are Amlodipine 5mg, taken every morning.", person: 'Mum', topics: ['family', 'health'] },
  { kind: 'memory', daysAgo: 24, hour: 19, content: 'Akosua is getting married in Kumasi on the 12th of December.', person: 'Akosua', location: 'Kumasi', topics: ['family', 'wedding'] },
  { kind: 'memory', daysAgo: 15, hour: 21, content: 'Nana Yaw wants football boots, size 5, for his birthday.', person: 'Nana Yaw', topics: ['family', 'birthday'] },
  { kind: 'memory', daysAgo: 3, hour: 18, content: 'Esi is collecting the kente for the wedding from the weaver in Bonwire.', person: 'Esi', location: 'Bonwire', topics: ['family', 'wedding'] },
  { kind: 'reminder', daysAgo: 16, hour: 12, task: 'Buy Nana Yaw his football boots', person: 'Nana Yaw', place: 'Accra Mall', dueHour: 17, status: 'fired' },
  { kind: 'reminder', daysAgo: -2, hour: 18, task: 'Call Mum', person: 'Mum', dueHour: 19, status: 'confirmed' },

  // --- Health ---
  { kind: 'memory', daysAgo: 33, hour: 14, content: 'Dr. Mensah said my vitamin D was low and to retest in three months.', person: 'Dr. Mensah', location: 'Nyaho Clinic', topics: ['health', 'bloodwork'] },
  { kind: 'memory', daysAgo: 19, hour: 7, content: 'Coach James set my 5k target at under 28 minutes by November.', person: 'James', topics: ['health', 'running'] },
  { kind: 'memory', daysAgo: 5, hour: 7, content: 'The morning run loop around Legon is 5.2 km.', location: 'Legon', topics: ['health', 'running'] },
  { kind: 'reminder', daysAgo: -1, hour: 7, task: 'Take the vitamin D tablet', dueHour: 8, status: 'confirmed', insistent: true, repeatDays: EVERY_DAY },

  // --- Errands / life ---
  { kind: 'memory', daysAgo: 47, hour: 13, content: 'The car is due its next service at 60,000 km at the Toyota workshop on Spintex Road.', location: 'Spintex Road', topics: ['car', 'maintenance'] },
  { kind: 'memory', daysAgo: 29, hour: 12, content: 'The landlord, Mr. Asante, takes rent by mobile money on the 1st of each month.', person: 'Mr. Asante', topics: ['home', 'rent'] },
  { kind: 'memory', daysAgo: 11, hour: 13, content: "The best waakye near the office is Auntie Muni's, and it sells out by 11am.", location: "Auntie Muni's", topics: ['food', 'lunch'] },
  { kind: 'memory', daysAgo: 1, hour: 20, content: 'Grace lent me her copy of Things Fall Apart and wants it back by the end of October.', person: 'Grace', topics: ['books', 'friends'] },
  { kind: 'reminder', daysAgo: 9, hour: 9, task: 'Renew the car insurance before it lapses', dueHour: 12, status: 'fired', insistent: true },
  { kind: 'reminder', daysAgo: -2, hour: 8, task: 'Pay Mr. Asante the rent by mobile money', person: 'Mr. Asante', dueHour: 9, status: 'confirmed', insistent: true },
];

/**
 * Substantial spoken recaps, run through the REAL extraction so their notes are
 * genuine (organised, nothing invented) rather than hand-written — and so each
 * populates the Memory tab with a note plus the memories/reminders it produced.
 * Spread across the seven weeks; three land older than the free window.
 */
const RECAPS: { daysAgo: number; hour: number; text: string }[] = [
  {
    // Today's standup with Kofi, so the People view has a clear, recent Kofi:
    // several facts attributed to him, one Kofi reminder, and one note.
    daysAgo: 0,
    hour: 10,
    text:
      'Just came out of the standup with Kofi. First, Kofi is pushing the Momo ' +
      'wallet launch to January because the Bank of Ghana review is still open. ' +
      'Second, Kofi is on leave the first two weeks of December for his cousin ' +
      "Akosua's wedding. Third, Kofi wants the payout API reviewed by two " +
      'engineers before it merges. Remind me to send Kofi the revised launch ' +
      'plan on Friday morning.',
  },
  {
    daysAgo: 38,
    hour: 16,
    text:
      "Just wrapped the quarterly planning with Michael and Yaw. We're dropping " +
      'the savings goals feature from this quarter because the partner bank ' +
      "can't give us the API until November. Yaw is taking over the agent " +
      'network pilot in Kumasi, and Michael wants the revised headcount plan by ' +
      'Friday. I need to send the board the updated roadmap before end of day.',
  },
  {
    daysAgo: 21,
    hour: 19,
    text:
      "Had a long call with Mum about Dad's checkup at Korle Bu. His sugar " +
      'levels are better and the doctor is happy, but he has to cut down on ' +
      'rice and walk every evening. Abena confirmed she is flying in from ' +
      'London for Christmas with the kids, so the spare room needs sorting. ' +
      'Remind me to order Dad a glucose meter.',
  },
  {
    daysAgo: 12,
    hour: 11,
    text:
      'Coffee with Kwame Boateng from the Stanbic partnerships team. They can ' +
      'offer merchants overdrafts of up to twenty thousand cedis if we share ' +
      'transaction history with consent. Kwame needs a one-page data sharing ' +
      'proposal, and their risk committee meets on the 15th of October.',
  },
  {
    daysAgo: 4,
    hour: 18,
    text:
      'Busy Saturday. The electrician fixed the socket in the kitchen and said ' +
      'the whole house needs rewiring within the year. Efua helped me pick the ' +
      'fabric for my wedding outfit at Makola, and the seamstress needs it by ' +
      'the 20th. I still need to book the bus to Kumasi for the wedding.',
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

  // Children first: the entity links, then the memories/reminders they point at.
  const { data: mems } = await supabase
    .from('memories')
    .select('id')
    .eq('user_id', userId)
    .in('capture_id', capIds);
  const { data: rems } = await supabase
    .from('reminders')
    .select('id')
    .eq('user_id', userId)
    .in('capture_id', capIds);
  const memIds = (mems ?? []).map((m: { id: string }) => m.id);
  const remIds = (rems ?? []).map((r: { id: string }) => r.id);
  if (memIds.length) await supabase.from('memory_entities').delete().in('memory_id', memIds);
  if (remIds.length) await supabase.from('reminder_entities').delete().in('reminder_id', remIds);

  await supabase.from('memories').delete().eq('user_id', userId).in('capture_id', capIds);
  await supabase.from('reminders').delete().eq('user_id', userId).in('capture_id', capIds);
  await supabase.from('captures').delete().eq('user_id', userId).eq('source', 'seed');
  console.log(`Cleared ${capIds.length} previous seed captures.`);
}

/**
 * Link a seeded row to its people (and, for memories, topics and place) the way
 * a real capture does, so the People view and person recall have them.
 */
async function linkEntities(
  userId: string,
  table: 'memories' | 'reminders',
  id: string,
  people: string[],
  topics: string[] = [],
  place: string | null = null
): Promise<void> {
  const groups: [EntityKind, string[]][] = [['person', people]];
  if (table === 'memories') {
    groups.push(['topic', topics]);
    if (place) groups.push(['place', [place]]);
  }
  const ids: string[] = [];
  for (const [kind, names] of groups) {
    ids.push(...(await resolveEntities(userId, kind, names)).map((e) => e.id));
  }
  if (table === 'memories') await linkMemoryToEntities(id, ids);
  else await linkReminderToEntities(id, ids);
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
      timezone: TIMEZONE,
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
    await linkEntities(
      userId,
      'memories',
      data.id,
      item.person ? [item.person] : [],
      item.topics,
      item.location ?? null
    );
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
      repeat_days: item.repeatDays ?? null,
      embedding: null,
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Reminder insert failed: ${error?.message}`);
  await linkEntities(userId, 'reminders', data.id, item.person ? [item.person] : []);
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
      await linkEntities(
        userId,
        'memories',
        data.id,
        action.people,
        action.topics,
        action.placeHint
      );
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
      await linkEntities(userId, 'reminders', data.id, action.people);
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
    SEED.filter((s) => s.daysAgo > FREE_DAYS).length +
    RECAPS.filter((r) => r.daysAgo > FREE_DAYS).length;
  console.log(
    `Inserted ${memories} memories and ${reminders} reminders across ` +
      `${SEED.length} facts + ${RECAPS.length} recaps ` +
      `(${older} captures older than ${FREE_DAYS} days — locked on Free).`
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
