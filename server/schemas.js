// Structured-output schemas for Claude. Enums are enforced by the API's
// constrained decoding; numeric ranges are stated in descriptions and enforced
// afterwards by the shared sanitizers, so a slightly-off number never throws
// away an otherwise great city plan.

import { z } from 'zod';
import { THEMED_ARCHETYPES, INVENTABLE_ARCHETYPES, LANDMARK_EFFECTS, BONUSES } from '../public/js/shared/catalog.js';
import { STYLES, WATER_TYPES, GREENERY_LEVELS, EVENT_EFFECTS, OBJECTIVE_TYPES, BUILD_TARGETS } from '../public/js/shared/plan.js';

const emoji = z.string().describe('Exactly one emoji');

const Mission = z.object({
  title: z.string().describe('Short themed mission name, at most 40 characters'),
  description: z.string().describe('One sentence: what to do and why, in the voice of this city'),
  objective: z.enum(OBJECTIVE_TYPES),
  target: z
    .number()
    .describe(
      'Goal value. population/jobs: people. money/monthly_income: currency. happiness/traffic_below/transit_share/employment: percent 0-100. build: number of buildings.',
    ),
  archetype: z.enum([...BUILD_TARGETS, 'none']).describe('Building type counted by "build" missions; "none" for every other objective'),
  minPopulation: z.number().describe('Population needed before the mission can complete; 0 if none'),
  reward: z.number().describe('Money paid on completion, roughly 300 to 15000'),
});

export const PlanSchema = z.object({
  cityName: z.string().describe('Evocative city name, at most 28 characters'),
  tagline: z.string().describe('One-line slogan'),
  vision: z.string().describe('Two sentences painting the city the player will build'),
  style: z.enum(STYLES).describe('Visual style of the city'),
  currency: z.string().describe('Local currency symbol, e.g. ₹, $, €'),
  terrain: z.object({
    water: z.enum(WATER_TYPES).describe('Main water feature of the map'),
    greenery: z.enum(GREENERY_LEVELS),
  }),
  highwayName: z.string().describe('Name of the regional highway crossing the map'),
  buildings: z
    .array(
      z.object({
        archetype: z.enum(THEMED_ARCHETYPES),
        name: z.string().describe('Themed name, at most 36 characters'),
        description: z.string().describe('One vivid sentence'),
        icon: emoji,
      }),
    )
    .describe('One entry for every archetype'),
  landmarks: z
    .array(
      z.object({
        name: z.string().describe('At most 36 characters'),
        description: z.string(),
        icon: emoji,
        effect: z.enum(LANDMARK_EFFECTS),
        unlockPopulation: z.number().describe('Population that unlocks it, 500 to 20000'),
      }),
    )
    .describe('Exactly 3 signature landmarks'),
  missions: z.array(Mission).describe('6 to 8 missions, easiest first'),
  events: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        effect: z.enum(EVENT_EFFECTS),
        magnitude: z.number().describe('1 (small) to 3 (big)'),
      }),
    )
    .describe('3 to 6 random events'),
  advisorName: z.string().describe('Name of the advisor character'),
  advisorIntro: z.string().describe('1-2 sentence welcome that addresses the player as Mayor'),
});

export const MissionBatchSchema = z.object({
  advice: z.string().describe("1-2 sentences of advice in the advisor's voice about the city's biggest issue"),
  missions: z.array(Mission).describe('Exactly 3 new missions'),
});

export const BuildingSchema = z.object({
  name: z.string().describe('At most 36 characters'),
  description: z.string().describe('One vivid sentence'),
  icon: emoji,
  archetype: z.enum(INVENTABLE_ARCHETYPES),
  bonus: z.enum(Object.keys(BONUSES)),
});

/**
 * JSON Schema for `output_config.format`. Sent untransformed so `enum` stays a
 * hard constraint (zod already emits `additionalProperties: false` and full
 * `required` lists, which structured outputs expect).
 */
export function toOutputSchema(schema) {
  const { $schema, ...json } = z.toJSONSchema(schema, { reused: 'inline' });
  return json;
}
