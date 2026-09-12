import { z } from "zod";

/** Mirrors Appendix B of the assessment brief exactly. */

export const BatchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1),
});
export type BatchCase = z.infer<typeof BatchCaseSchema>;

export const BatchInputSchema = z.array(BatchCaseSchema);

export const BatchErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type BatchError = z.infer<typeof BatchErrorSchema>;

export const BatchResultSchema = z.object({
  id: z.string(),
  status: z.enum(["ok", "failed"]),
  kit: z.unknown().nullable(),
  error: BatchErrorSchema.nullable(),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;

export const BatchOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  kits: z.array(BatchResultSchema),
});
export type BatchOutput = z.infer<typeof BatchOutputSchema>;
