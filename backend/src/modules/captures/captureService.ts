import { supabase } from '../../services/supabase';

export type CaptureInput = {
  text: string;
  clientTime: string;
  timezone: string;
  source?: 'text' | 'voice';
  transcriptConfidence?: number | null;
};

export type Capture = {
  id: string;
  text: string;
  client_time: string | null;
  timezone: string | null;
  source: string | null;
  created_at: string;
};

/**
 * The raw utterance, stored verbatim and never overwritten.
 *
 * Previously /interpret discarded this entirely, which meant (a) the extraction
 * prompt could never be re-run over past input, and (b) "what did I actually
 * say?" could only be answered with the model's paraphrase. For a memory
 * product that is the wrong thing to lose.
 */
export async function createCapture(
  userId: string,
  input: CaptureInput
): Promise<Capture> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('Capture text cannot be empty.');
  }

  const { data, error } = await supabase
    .from('captures')
    .insert({
      user_id: userId,
      text,
      client_time: input.clientTime,
      timezone: input.timezone,
      source: input.source ?? 'text',
      transcript_conf: input.transcriptConfidence ?? null,
    })
    .select('id, text, client_time, timezone, source, created_at')
    .single();

  if (error) {
    console.error('Database capture error:', error);
    throw new Error('Failed to save capture.');
  }

  return data as Capture;
}
