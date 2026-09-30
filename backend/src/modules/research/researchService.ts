import { z } from 'zod';

import { supabase } from '../../services/supabase';
import { aiProvider } from '../ai';
import {
  RESEARCH_PLAN_PROMPT,
  RESEARCH_WRITE_PROMPT,
  researchNotePrompt,
  type ResearchFormat,
} from '../ai/prompts';
import { MAX_NOTE_BODY } from '../library/libraryInput';

import { referencesBlock, renumberCitations } from './citations';
import { searchOpenAlex, searchWikipedia, type ResearchSource } from './sources';

/**
 * Mr. Kandoo's research (Elite). The AI never touches the database and never
 * invents a reference (AGENTS §3.1): it plans general queries, real sources are
 * fetched, it writes ONLY from those sources, and the reference list is built
 * here from what was actually fetched and cited.
 */

const planSchema = z.object({
  queries: z.array(z.string().min(1).max(80)).min(1).max(3),
  scholarly: z.boolean().default(true),
});

const writeSchema = z.object({
  spoken: z.string().min(1).max(800),
  findings: z.string().min(1).max(6000),
});

const noteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(MAX_NOTE_BODY),
});

export type ResearchResult = {
  question: string;
  /** The category whose notes gave the research its context, if any. */
  category: string | null;
  /** What Mr. Kandoo says aloud. */
  spoken: string;
  /** Structured findings with [n] citations into `sources`. */
  findings: string;
  /** Only the sources the findings cite, numbered from 1 in order of use. */
  sources: ResearchSource[];
  /** False when no source could be found: nothing is claimed from thin air. */
  grounded: boolean;
};

/** Project context for the writer: a category's notes, newest first, bounded. */
async function projectContext(userId: string, categoryId: string): Promise<{ name: string; text: string } | null> {
  const { data: category, error } = await supabase
    .from('library_categories')
    .select('id, name')
    .eq('user_id', userId)
    .eq('id', categoryId)
    .maybeSingle();
  if (error) throw error;
  if (!category) return null;

  const { data: notes, error: notesError } = await supabase
    .from('library_notes')
    .select('title, body')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('updated_at', { ascending: false })
    .limit(12);
  if (notesError) throw notesError;

  const text = (notes ?? [])
    .map((n) => `${n.title ? `${n.title}: ` : ''}${n.body}`)
    .join('\n\n')
    .slice(0, 6000);
  return { name: category.name as string, text };
}

function dedupe(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = s.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runResearch(
  userId: string,
  input: { question: string; categoryId: string | null }
): Promise<ResearchResult> {
  const project = input.categoryId ? await projectContext(userId, input.categoryId) : null;

  // 1. Plan: general queries only (they leave Kandoo).
  const plan = planSchema.parse(
    await aiProvider.generateJson(
      RESEARCH_PLAN_PROMPT,
      `Question: ${input.question}${project ? `\n\nProject "${project.name}" notes (for understanding only — never put their details in a query):\n${project.text.slice(0, 2000)}` : ''}`,
      300
    )
  );

  // 2. Fetch real sources, in parallel, best-effort.
  const batches = await Promise.all(
    plan.queries.flatMap((q) => [
      searchWikipedia(q, 2),
      // Papers help most questions worth researching; fewer when the planner
      // judged it an everyday how-to.
      searchOpenAlex(q, plan.scholarly ? 3 : 1),
    ])
  );
  const sources = dedupe(batches.flat()).slice(0, 10);

  if (sources.length === 0) {
    return {
      question: input.question,
      category: project?.name ?? null,
      spoken: 'I couldn’t reach any sources for that just now, so I won’t guess. Try asking it a different way, or again in a moment.',
      findings: '',
      sources: [],
      grounded: false,
    };
  }

  // 3. Write ONLY from those sources.
  const numbered = sources
    .map((s, i) => `[${i + 1}] ${s.title}${s.year ? ` (${s.year})` : ''} — ${s.publisher ?? s.kind}\n${s.excerpt}`)
    .join('\n\n');
  const written = writeSchema.parse(
    await aiProvider.generateJson(
      RESEARCH_WRITE_PROMPT,
      [
        `Question: ${input.question}`,
        project ? `Project "${project.name}" notes (context only, never cite):\n${project.text}` : null,
        `Sources:\n${numbered}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      1500
    )
  );

  const cited = renumberCitations(written.findings, sources);
  return {
    question: input.question,
    category: project?.name ?? null,
    spoken: written.spoken,
    findings: cited.text,
    sources: cited.sources,
    grounded: cited.sources.length > 0,
  };
}

/** The findings as a Library note in the shape the user asked for, with references. */
export async function writeResearchNote(input: {
  question: string;
  findings: string;
  sources: ResearchSource[];
  format: ResearchFormat;
}): Promise<{ title: string; body: string }> {
  const note = noteSchema.parse(
    await aiProvider.generateJson(
      researchNotePrompt(input.format),
      `Question researched: ${input.question}\n\nFindings:\n${input.findings}`,
      2500
    )
  );
  const cited = renumberCitations(note.body, input.sources);
  const references = referencesBlock(cited.sources);
  const body = `${cited.text}${references ? `\n\n${references}` : ''}`;
  return { title: note.title, body: body.slice(0, MAX_NOTE_BODY) };
}
