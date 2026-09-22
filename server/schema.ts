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
      { code: 'custom', path: ['highlights'], message: 'KI-Zeitmarke liegt außerhalb des Videos.' },
    ]);
  return {
    ...result,
    tags: [...new Set(result.tags)],
    highlights: result.highlights.sort((a, b) => a.seconds - b.seconds),
  };
}
export const analysisJsonSchema = z.toJSONSchema(analysisSchema);

/**
 * Festes Tag-Vokabular für die KI. Freitext-Tags haben in der Praxis fast immer die Auflage
 * eins ("Warnbänder", "Fahrradständer") und filtern damit nichts — die Bibliothek bietet aber
 * Filter über Tags an. Beim Bearbeiten im Archiv bleiben freie Tags erlaubt, siehe
 * clipPatchSchema; diese Liste bindet nur die Vorschläge der Analyse.
 */
export const CLIP_TAGS = [
  'Kill',
  'Multikill',
  'Clutch',
  'Ace',
  'Sieg',
  'Niederlage',
  'Rundensieg',
  'Tod',
  'Knapp',
  'Fail',
  'Rettung',
  'Sniper',
  'Teamplay',
  'Glück',
  'Comeback',
  'Rundenstart',
  'Rundenende',
  'Wiederbelebung',
  'Menü',
  'Ladebildschirm',
  'Kein Ereignis',
] as const;
/**
 * Antwortschema der Zusammenfassung. Bis auf die gebundenen Tags gleich dem Analyseschema,
 * sodass parseAnalysis unverändert prüft und gespeicherte Clips ihre Form behalten.
 */
export const summaryJsonSchema = z.toJSONSchema(
  analysisSchema.extend({ tags: z.array(z.enum(CLIP_TAGS)).max(6) }),
);

/**
 * Bildarten für die Vorsortierung. Nicht jedes Bild einer Aufnahme zeigt Spielgeschehen:
 * Ladebildschirme, Kaufmenüs und Wiederbelebungsansichten dürfen keinen Titel bestimmen.
 */
export const frameKinds = ['gameplay', 'result', 'menu', 'loading', 'respawn', 'other'] as const;
export const frameObservationSchema = z.object({
  frame: z.number().int().min(0).max(7),
  kind: z.enum(frameKinds),
  observation: z.string().trim().max(180),
  visibleText: z.string().trim().max(120),
});
export const frameBatchSchema = z.object({
  frames: z.array(frameObservationSchema).min(1).max(8),
});
export type FrameObservation = z.infer<typeof frameObservationSchema>;
export const frameBatchJsonSchema = z.toJSONSchema(frameBatchSchema);
export function parseFrameBatch(raw: string, expected: number) {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const { frames } = frameBatchSchema.parse(JSON.parse(clean));
  const indices = new Set(frames.map((f) => f.frame));
  if (frames.length !== expected || indices.size !== expected)
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['frames'],
        message: 'Die KI hat Bilder doppelt oder gar nicht eingeordnet.',
      },
    ]);
  return frames;
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
