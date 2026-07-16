import { z } from "zod";

/**
 * Science-based training-split templates (E-expansion). A split maps a chosen
 * weekly training frequency to an ordered rotation of "routines" (training
 * days). The engine consumes the resolved routine sequence; muscle membership
 * per routine lives in the engine. Splits are curated config, validated here.
 */

export type Routine =
  | "full_body"
  | "upper"
  | "lower"
  | "push"
  | "pull"
  | "legs"
  | "chest_back"
  | "shoulders_arms";

export const ROUTINES: readonly Routine[] = [
  "full_body",
  "upper",
  "lower",
  "push",
  "pull",
  "legs",
  "chest_back",
  "shoulders_arms"
];

export interface SplitTemplate {
  id: string;
  name: string;
  description: string;
  /** Ordered routine rotation for each supported weekly frequency. */
  sessionsByFrequency: Record<number, Routine[]>;
}

export const SPLIT_TEMPLATES: SplitTemplate[] = [
  {
    id: "full_body",
    name: "Full Body",
    description:
      "Every session trains the whole body. High frequency per muscle, ideal for 2–3 days/week and beginners.",
    sessionsByFrequency: {
      2: ["full_body", "full_body"],
      3: ["full_body", "full_body", "full_body"]
    }
  },
  {
    id: "upper_lower",
    name: "Upper / Lower",
    description:
      "Alternates upper-body and lower-body days. Balances volume and recovery well at 4 days/week.",
    sessionsByFrequency: {
      4: ["upper", "lower", "upper", "lower"]
    }
  },
  {
    id: "push_pull_legs",
    name: "Push / Pull / Legs",
    description:
      "Groups muscles by movement: pushing, pulling, and legs. Scales from 3 days to a 6-day double.",
    sessionsByFrequency: {
      3: ["push", "pull", "legs"],
      6: ["push", "pull", "legs", "push", "pull", "legs"]
    }
  },
  {
    id: "ppl_upper_lower",
    name: "PPL + Upper / Lower",
    description:
      "A 5-day hybrid: push, pull and legs followed by an upper and a lower day. Strong volume without 6 sessions.",
    sessionsByFrequency: {
      5: ["push", "pull", "legs", "upper", "lower"]
    }
  },
  {
    id: "arnold",
    name: "Arnold Split",
    description:
      "Classic 6-day split: chest+back, shoulders+arms, then legs, repeated twice. High volume for advanced lifters.",
    sessionsByFrequency: {
      6: ["chest_back", "shoulders_arms", "legs", "chest_back", "shoulders_arms", "legs"]
    }
  }
];

export const splitTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  sessionsByFrequency: z.record(
    z.string().regex(/^\d+$/),
    z.array(z.enum(ROUTINES as [Routine, ...Routine[]])).min(1)
  )
});

/** Frequencies (days/week) a template supports. */
export function templateFrequencies(template: SplitTemplate): number[] {
  return Object.keys(template.sessionsByFrequency)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Templates that support a given weekly training frequency, best-fit first. */
export function recommendSplits(daysPerWeek: number): SplitTemplate[] {
  return SPLIT_TEMPLATES.filter((t) => daysPerWeek in t.sessionsByFrequency);
}

/** Resolve a split id + frequency to its weekly routine rotation. */
export function resolveWeeklyRoutines(splitId: string, daysPerWeek: number): Routine[] | undefined {
  const template = SPLIT_TEMPLATES.find((t) => t.id === splitId);
  return template?.sessionsByFrequency[daysPerWeek];
}

/**
 * Align the five-day hybrid to recovery breaks. A two-day training block gets
 * Upper/Lower and a three-day block gets Push/Pull/Legs.
 */
export function resolveWeeklyRoutinesForDays(
  splitId: string,
  daysPerWeek: number,
  trainingDays: number[]
): Routine[] | undefined {
  const fallback = resolveWeeklyRoutines(splitId, daysPerWeek);
  const sorted = [...new Set(trainingDays)].sort((a, b) => a - b);
  if (splitId !== "ppl_upper_lower" || daysPerWeek !== 5 || sorted.length !== 5) return fallback;

  const gaps = sorted.map((day, index) => {
    const next = sorted[(index + 1) % sorted.length]!;
    return (next - day + 7) % 7;
  });
  const largestGapIndex = gaps.indexOf(Math.max(...gaps));
  const cyclicDays = Array.from(
    { length: sorted.length },
    (_, offset) => sorted[(largestGapIndex + 1 + offset) % sorted.length]!
  );
  const blocks: number[][] = [];
  for (const day of cyclicDays) {
    const block = blocks.at(-1);
    const previous = block?.at(-1);
    if (!block || previous === undefined || (day - previous + 7) % 7 > 1) blocks.push([day]);
    else block.push(day);
  }
  if (
    blocks.length !== 2 ||
    !blocks.some((block) => block.length === 2) ||
    !blocks.some((block) => block.length === 3)
  )
    return fallback;

  const byDay = new Map<number, Routine>();
  for (const block of blocks) {
    const routines: Routine[] = block.length === 2 ? ["upper", "lower"] : ["push", "pull", "legs"];
    block.forEach((day, index) => byDay.set(day, routines[index]!));
  }
  return sorted.map((day) => byDay.get(day)!);
}

/** All distinct weekly frequencies supported by any template (2–6). */
export function supportedFrequencies(): number[] {
  const set = new Set<number>();
  for (const template of SPLIT_TEMPLATES) {
    for (const freq of templateFrequencies(template)) set.add(freq);
  }
  return [...set].sort((a, b) => a - b);
}
