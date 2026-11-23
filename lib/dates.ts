import { z } from "zod";

export const REPORTING_DATE = "2025-10-31";

export const metricInputSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  product: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
}).refine((input) => input.startDate <= input.endDate, {
  path: ["endDate"],
  message: "End date must be on or after the start date.",
});

export type MetricInput = z.infer<typeof metricInputSchema>;
export type DateRange = Pick<MetricInput, "startDate" | "endDate">;
export const datePresetSchema = z.enum([
  "last-week",
  "this-week",
  "this-month",
  "last-month",
  "trailing-30-days",
]);
export type DatePreset = z.infer<typeof datePresetSchema>;

const DAY_MS = 86_400_000;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function resolveDateRange(
  preset: DatePreset = "trailing-30-days",
  anchor = REPORTING_DATE,
): DateRange {
  const date = new Date(z.iso.date().parse(anchor));
  const daysAgo = (days: number) => isoDay(new Date(date.getTime() - days * DAY_MS));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;

  if (preset === "last-week") {
    return { startDate: daysAgo(daysSinceMonday + 7), endDate: daysAgo(daysSinceMonday + 1) };
  }
  if (preset === "this-week") {
    return { startDate: daysAgo(daysSinceMonday), endDate: anchor };
  }
  if (preset === "this-month") {
    return { startDate: `${anchor.slice(0, 7)}-01`, endDate: anchor };
  }
  if (preset === "last-month") {
    date.setUTCDate(0);
    const endDate = isoDay(date);
    return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
  }
  return { startDate: daysAgo(29), endDate: anchor };
}
