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
