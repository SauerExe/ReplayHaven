import { z } from 'zod';
export const analysisSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1800),
  game: z.string().trim().max(100),
  tags: z.array(z.string().trim().min(1).max(40)).max(10),
  confidence: z.enum(['low', 'medium', 'high']),
  uncertainty: z.string().max(500),
  highlights: z
    .array(
      z.object({
        seconds: z.number().finite().min(0),
        title: z.string().trim().min(1).max(120),
        description: z.string().max(400),
      }),
    )
    .max(8),
});
export type AnalysisResult = z.infer<typeof analysisSchema>;
export function parseAnalysis(raw: string, duration: number): AnalysisResult {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const result = analysisSchema.parse(JSON.parse(clean));
  if (result.highlights.some((h) => h.seconds > duration))
    throw new z.ZodError([
      { code: 'custom', path: ['highlights'], message: 'AI time mark lies outside the video.' },
    ]);
  return {
    ...result,
    tags: [...new Set(result.tags)],
    highlights: result.highlights.sort((a, b) => a.seconds - b.seconds),
  };
}
export const analysisJsonSchema = z.toJSONSchema(analysisSchema);

/**
 * Tags the analysis assigns. Free-text tags almost always occurred only once, and when picked
 * freely from a list, "Tod" stuck to 20 of 45 clips. So the model no longer picks tags: they
 * follow from confirmed events (agent/events.ts). Free tags stay allowed when editing in the
 * archive, see clipPatchSchema.
 */
export const CLIP_TAGS = [
  'Kill',
  'Multikill',
  'Headshot',
  'Ace',
  'Clutch',
  'Tod',
  'Rundensieg',
  'Runde verloren',
  'Sieg',
  'Niederlage',
  'Ladebildschirm',
  'Menü',
] as const;
/**
 * Response schema of the summary. The code decides game, tags and confidence; the model only
 * writes what cannot be derived. The lengths constrain the output during generation already.
 */
export const summarySchema = z.object({
  title: z.string().max(80),
  description: z.string().max(700),
  uncertainty: z.string().max(300),
  highlights: z
    .array(
      z.object({
        seconds: z.number().min(0),
        title: z.string().max(60),
        description: z.string().max(200),
      }),
    )
    .max(6),
});
export type SummaryResult = z.infer<typeof summarySchema>;
export const summaryJsonSchema = z.toJSONSchema(summarySchema);
/** Reads the summary. Invalid time marks are dropped instead of discarding the analysis. */
export function parseSummary(raw: string, duration: number): SummaryResult {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const data: unknown = JSON.parse(clean);
  // "null" or a bare string is valid JSON but no summary; it must count as unusable, not crash.
  if (!isRecord(data))
    throw new z.ZodError([{ code: 'custom', path: [], message: 'No JSON object.' }]);
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const title = text(data.title, 80);
  if (!title) throw new z.ZodError([{ code: 'custom', path: ['title'], message: 'No title.' }]);
  return {
    title,
    description: text(data.description, 700),
    uncertainty: text(data.uncertainty, 300),
    highlights: (Array.isArray(data.highlights) ? data.highlights : [])
      .filter(isRecord)
      .map((h) => ({
        seconds: Number(h.seconds),
        title: text(h.title, 60),
        description: text(h.description, 200),
      }))
      .filter(
        (h) => Number.isFinite(h.seconds) && h.seconds >= 0 && h.seconds <= duration && h.title,
      )
      .slice(0, 6),
  };
}

/** A parsed JSON object, as opposed to null, an array or a bare value. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Frame kinds for pre-sorting. Not every frame of a recording shows gameplay: loading screens,
 * buy menus and respawn views must not determine a title.
 */
export const frameKinds = ['gameplay', 'result', 'menu', 'loading', 'respawn', 'other'] as const;
export const frameObservationSchema = z.object({
  frame: z.number().int().min(0),
  kind: z.enum(frameKinds),
  observation: z.string().trim().max(180),
  visibleText: z.string().trim().max(120),
});
export const frameBatchSchema = z.object({
  frames: z.array(frameObservationSchema).min(1).max(8),
});
export type FrameObservation = z.infer<typeof frameObservationSchema>;
export const frameBatchJsonSchema = z.toJSONSchema(frameBatchSchema);
/**
 * Reads the classification of a frame batch. The model sometimes numbers frames from 1 or keeps
 * counting across batches (4–7 instead of 0–3). So if the count is right, the order applies; only
 * a wrong count is an error. Previously such answers aborted the whole analysis, in the baseline
 * run of 2026-09-23 for 4 of 20 clips (experiment E17).
 */
export function parseFrameBatch(raw: string, expected: number) {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const { frames } = frameBatchSchema.parse(JSON.parse(clean));
  if (frames.length !== expected)
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['frames'],
        message: 'The AI classified frames twice or not at all.',
      },
    ]);
  const indices = new Set(frames.map((f) => f.frame));
  const ordered = indices.size === expected && [...indices].every((i) => i < expected);
  return ordered
    ? [...frames].sort((a, b) => a.frame - b.frame)
    : frames.map((f, frame) => ({ ...f, frame }));
}
/**
 * Unusable answer, as opposed to a connection or abort error. A hand-built ZodError is not an
 * `instanceof Error` in zod 4 — checking for that meant the retry on a wrong frame count never
 * kicked in.
 */
export function isParseError(error: unknown) {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}
/**
 * Last resort after two unusable answers: keeps whatever can be assigned to a frame and fills
 * the rest in as unclear. A gap costs one frame, not the whole clip.
 */
export function salvageFrameBatch(raw: string, expected: number): FrameObservation[] {
  let listed: unknown[] = [];
  try {
    const data = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
    if (Array.isArray(data?.frames)) listed = data.frames;
  } catch {
    // No readable answer: all frames stay unclear.
  }
  const valid = listed.flatMap((f) => {
    const parsed = frameObservationSchema.safeParse(f);
    return parsed.success ? [parsed.data] : [];
  });
  // With exactly matching numbering the index applies, otherwise the order.
  const byIndex = new Map(valid.filter((f) => f.frame < expected).map((f) => [f.frame, f]));
  const usable = byIndex.size === valid.length ? byIndex : new Map(valid.map((f, i) => [i, f]));
  return Array.from({ length: expected }, (_, frame) => {
    const found = usable.get(frame);
    return found
      ? { ...found, frame }
      : { frame, kind: 'other' as const, observation: '', visibleText: '' };
  });
}
export const settingsSchema = z.object({
  autoAnalyze: z.boolean(),
  autoTitle: z.boolean(),
  includeAudio: z.boolean(),
});
export type AnalysisSettings = z.infer<typeof settingsSchema>;
export const clipPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1800).optional(),
    gameName: z.string().max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    favorite: z.boolean().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();
