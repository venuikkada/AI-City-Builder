// Claude integration: city plans, advisor missions and invented buildings via
// structured outputs. Every result is re-validated by the shared sanitizers.

import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { PlanSchema, MissionBatchSchema, BuildingSchema, toOutputSchema } from './schemas.js';
import { PLAN_SYSTEM, MISSIONS_SYSTEM, BUILDING_SYSTEM, planUserMessage, missionsUserMessage, buildingUserMessage } from './prompts.js';
import { sanitizePlan, sanitizeMissionBatch, sanitizeBuildingIdea } from '../public/js/shared/plan.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
// Server-side refusal fallback: if the model declines, Anthropic retries on its recommended fallback model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OUTPUT_SCHEMAS = new Map([PlanSchema, MissionBatchSchema, BuildingSchema].map((s) => [s, toOutputSchema(s)]));

export class AiUnavailableError extends Error {
  name = 'AiUnavailableError';
}
export class AiRefusalError extends Error {
  name = 'AiRefusalError';
}
export class AiOutputError extends Error {
  name = 'AiOutputError';
}

/** AI is on when credentials are configured (AI_ENABLED=1 forces it for `ant auth login` profiles). */
export function hasCredentials(env = process.env) {
  if (['0', 'false', 'off'].includes(String(env.AI_ENABLED).toLowerCase())) return false;
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE || ['1', 'true'].includes(String(env.AI_ENABLED).toLowerCase()));
}

export function createAi({ client, env = process.env, logger = console } = {}) {
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  let enabled = Boolean(client) || hasCredentials(env);
  const anthropic = client || (enabled ? new Anthropic() : null);
  const isHaiku = /haiku/i.test(model);
  const effortOverride = EFFORTS.includes(env.AI_EFFORT) ? env.AI_EFFORT : null;
  const useFallbacks = !isHaiku && env.AI_FALLBACKS !== 'off';

  async function generate(kind, { system, user, schema, effort, timeout }) {
    if (!enabled) throw new AiUnavailableError('AI is not configured');
    const params = {
      model,
      max_tokens: 16000,
      cache_control: { type: 'ephemeral' },
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        format: betaJSONSchemaOutputFormat(OUTPUT_SCHEMAS.get(schema), { transform: false }),
        ...(isHaiku ? {} : { effort: effortOverride || effort }),
      },
      ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
    };
    const started = Date.now();
    let response;
    try {
      response = await anthropic.beta.messages.parse(params, { timeout, maxRetries: 1 });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        enabled = false;
        logger.warn(`[ai] ${kind}: credentials were rejected (${err.status}); using the offline planner from now on`);
        throw err;
      }
      if (err instanceof Anthropic.APIError) throw err;
      // .parse() raises a plain AnthropicError when the output isn't valid JSON.
      if (err instanceof Anthropic.AnthropicError) throw new AiOutputError(err.message);
      throw err;
    }
    if (response.stop_reason === 'refusal') {
      throw new AiRefusalError(`The model declined (${response.stop_details?.category ?? 'unspecified'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new AiOutputError('The response was cut off');
    if (!response.parsed_output) throw new AiOutputError('The response had no structured output');
    logger.info(
      `[ai] ${kind} ok in ${Date.now() - started}ms · ${response.model} · ${response.usage?.input_tokens ?? '?'} in / ${response.usage?.output_tokens ?? '?'} out`,
    );
    return response.parsed_output;
  }

  return {
    model,
    get enabled() {
      return enabled;
    },

    async plan(prompt) {
      const raw = await generate('plan', {
        system: PLAN_SYSTEM,
        user: planUserMessage(prompt),
        schema: PlanSchema,
        effort: 'medium',
        timeout: 120_000,
      });
      return sanitizePlan({ ...raw, source: 'ai' }, { prompt });
    },

    async missions(context) {
      const raw = await generate('missions', {
        system: MISSIONS_SYSTEM,
        user: missionsUserMessage(context),
        schema: MissionBatchSchema,
        effort: 'low',
        timeout: 60_000,
      });
      return sanitizeMissionBatch(raw, { landmarkCount: context.landmarks.length || 3 });
    },

    async building(idea, city) {
      const raw = await generate('building', {
        system: BUILDING_SYSTEM,
        user: buildingUserMessage(idea, city),
        schema: BuildingSchema,
        effort: 'low',
        timeout: 60_000,
      });
      return sanitizeBuildingIdea(raw);
    },
  };
}
