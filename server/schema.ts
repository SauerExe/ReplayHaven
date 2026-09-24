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
 * Tags, die die Analyse vergibt. Freitext-Tags hatten fast immer die Auflage eins, und frei aus
 * einer Liste gewählt klebte "Tod" an 20 von 45 Clips. Deshalb wählt das Modell keine Tags
 * mehr: sie folgen aus belegten Ereignissen (agent/events.ts). Beim Bearbeiten im Archiv bleiben
 * freie Tags erlaubt, siehe clipPatchSchema.
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
 * Antwortschema der Zusammenfassung. Spiel, Tags und Sicherheit bestimmt der Code; das Modell
 * schreibt nur, was sich nicht ableiten lässt. Die Längen binden die Ausgabe schon beim Erzeugen.
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
/** Liest die Zusammenfassung. Ungültige Zeitmarken fallen weg, statt die Analyse zu verwerfen. */
export function parseSummary(raw: string, duration: number): SummaryResult {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const data = JSON.parse(clean) as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const title = text(data.title, 80);
  if (!title) throw new z.ZodError([{ code: 'custom', path: ['title'], message: 'Kein Titel.' }]);
  return {
    title,
    description: text(data.description, 700),
    uncertainty: text(data.uncertainty, 300),
    highlights: (Array.isArray(data.highlights) ? data.highlights : [])
      .map((h: Record<string, unknown>) => ({
        seconds: Number(h?.seconds),
        title: text(h?.title, 60),
        description: text(h?.description, 200),
      }))
      .filter(
        (h) => Number.isFinite(h.seconds) && h.seconds >= 0 && h.seconds <= duration && h.title,
      )
      .slice(0, 6),
  };
}

/**
 * Bildarten für die Vorsortierung. Nicht jedes Bild einer Aufnahme zeigt Spielgeschehen:
 * Ladebildschirme, Kaufmenüs und Wiederbelebungsansichten dürfen keinen Titel bestimmen.
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
 * Liest die Einordnung eines Bildpakets. Das Modell nummeriert die Bilder gelegentlich ab 1 oder
 * zählt über Pakete hinweg weiter (4–7 statt 0–3). Stimmt die Anzahl, gilt deshalb die
 * Reihenfolge; nur eine falsche Anzahl ist ein Fehler. Vorher brach an solchen Antworten die ganze
 * Analyse ab, im Vorher-Lauf vom 2026-09-23 bei 4 von 20 Clips (.docs/05-experimente.md, E17).
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
        message: 'Die KI hat Bilder doppelt oder gar nicht eingeordnet.',
      },
    ]);
  const indices = new Set(frames.map((f) => f.frame));
  const ordered = indices.size === expected && [...indices].every((i) => i < expected);
  return ordered
    ? [...frames].sort((a, b) => a.frame - b.frame)
    : frames.map((f, frame) => ({ ...f, frame }));
}
/**
 * Unbrauchbare Antwort statt Verbindungs- oder Abbruchfehler. Ein von Hand erzeugter ZodError
 * ist in zod 4 kein `instanceof Error` — die Prüfung darauf ließ die Wiederholung bei falscher
 * Bildanzahl nie greifen.
 */
export function isParseError(error: unknown) {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}
/**
 * Letzter Ausweg nach zwei unbrauchbaren Antworten: übernimmt, was sich einem Bild zuordnen
 * lässt, und füllt den Rest als unklar auf. Eine Lücke kostet ein Bild, nicht den ganzen Clip.
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
    // Keine lesbare Antwort: alle Bilder bleiben unklar.
  }
  const valid = listed.flatMap((f) => {
    const parsed = frameObservationSchema.safeParse(f);
    return parsed.success ? [parsed.data] : [];
  });
  // Bei genau passender Nummerierung gilt der Index, sonst die Reihenfolge.
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
