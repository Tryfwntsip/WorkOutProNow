import { describe, expect, it } from "vitest";
import {
  SPLIT_TEMPLATES,
  recommendSplits,
  resolveWeeklyRoutines,
  resolveWeeklyRoutinesForDays,
  splitTemplateSchema,
  supportedFrequencies,
  templateFrequencies
} from "../src/splits.js";

describe("split templates", () => {
  it("every template is structurally valid", () => {
    for (const template of SPLIT_TEMPLATES) {
      expect(splitTemplateSchema.safeParse(template).success).toBe(true);
    }
  });

  it("each rotation length matches its declared frequency", () => {
    for (const template of SPLIT_TEMPLATES) {
      for (const freq of templateFrequencies(template)) {
        expect(template.sessionsByFrequency[freq]!.length).toBe(freq);
      }
    }
  });

  it("recommends at least one split for every supported frequency 2..6", () => {
    for (const freq of [2, 3, 4, 5, 6]) {
      expect(recommendSplits(freq).length).toBeGreaterThanOrEqual(1);
    }
    expect(supportedFrequencies()).toEqual([2, 3, 4, 5, 6]);
  });

  it("resolves a known split + frequency to its rotation", () => {
    expect(resolveWeeklyRoutines("push_pull_legs", 3)).toEqual(["push", "pull", "legs"]);
    expect(resolveWeeklyRoutines("arnold", 6)).toEqual([
      "chest_back",
      "shoulders_arms",
      "legs",
      "chest_back",
      "shoulders_arms",
      "legs"
    ]);
  });

  it("returns undefined for an unsupported split/frequency combination", () => {
    expect(resolveWeeklyRoutines("full_body", 6)).toBeUndefined();
    expect(resolveWeeklyRoutines("does_not_exist", 3)).toBeUndefined();
  });

  it("aligns the five-day hybrid to recovery breaks", () => {
    expect(resolveWeeklyRoutinesForDays("ppl_upper_lower", 5, [1, 2, 4, 5, 6])).toEqual([
      "upper",
      "lower",
      "push",
      "pull",
      "legs"
    ]);
  });
});
