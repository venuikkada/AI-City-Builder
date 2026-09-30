import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { createAi, hasCredentials, DEFAULT_MODEL, AiRefusalError, AiOutputError, AiUnavailableError } from '../server/ai.js';
import { toOutputSchema, PlanSchema } from '../server/schemas.js';

const quiet = { info() {}, warn() {}, error() {} };

/** Minimal stand-in for the Anthropic client that records requests. */
function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async parse(params, options) {
          calls.push({ params, options });
          return respond(params);
        },
      },
    },
  };
}

const aiPlan = {
  cityName: 'Neo Hyderabad',
  tagline: 'Where the Deccan meets tomorrow',
  vision: 'Maglev avenues and vertical gardens.',
  style: 'futuristic',
  currency: '₹',
  terrain: { water: 'lake', greenery: 'medium' },
  highwayName: 'ORR Hyperway',
  buildings: [{ archetype: 'techpark', name: 'Quantum HITEC Campus', description: 'Qubits galore.', icon: '💻' }],
  landmarks: [{ name: 'Charminar Holo-Arch', description: 'Light show.', icon: '🕌', effect: 'tourism', unlockPopulation: 1000 }],
  missions: [
    { title: 'First Families', description: 'Settle in.', objective: 'population', target: 300, archetype: 'none', minPopulation: 0, reward: 500 },
    { title: 'Tech Boom', description: 'Jobs!', objective: 'jobs', target: 800, archetype: 'none', minPopulation: 0, reward: 900 },
    { title: 'Metro Line', description: 'Ride.', objective: 'build', target: 2, archetype: 'metro', minPopulation: 0, reward: 3000 },
  ],
  events: [{ title: 'Biryani Week', description: 'Yum.', effect: 'money_bonus', magnitude: 2 }],
  advisorName: 'Nizam-9',
  advisorIntro: 'Adaab, Mayor!',
};

const ok = (parsed) => () => ({ stop_reason: 'end_turn', parsed_output: parsed, model: DEFAULT_MODEL, usage: { input_tokens: 1, output_tokens: 1 } });

test('credentials decide whether AI is on', () => {
  assert.equal(hasCredentials({}), false);
  assert.equal(hasCredentials({ ANTHROPIC_API_KEY: 'sk-test' }), true);
  assert.equal(hasCredentials({ ANTHROPIC_API_KEY: 'sk-test', AI_ENABLED: '0' }), false);
  assert.equal(hasCredentials({ AI_ENABLED: '1' }), true);
  assert.equal(createAi({ env: {}, logger: quiet }).enabled, false);
});

test('plan requests use structured outputs, effort and refusal fallbacks', async () => {
  const client = fakeClient(ok(aiPlan));
  const ai = createAi({ client, env: {}, logger: quiet });
  const plan = await ai.plan('Build a futuristic Hyderabad.');
  const { params, options } = client.calls[0];
  assert.equal(params.model, DEFAULT_MODEL);
  assert.equal(params.output_config.effort, 'medium');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.ok(params.messages[0].content.includes('Build a futuristic Hyderabad.'));
  assert.ok(options.timeout > 0);

  assert.equal(plan.source, 'ai');
  assert.equal(plan.cityName, 'Neo Hyderabad');
  assert.equal(plan.names.techpark.name, 'Quantum HITEC Campus');
  assert.equal(plan.names.house.name, 'Homes', 'missing archetypes filled in');
  assert.equal(plan.prompt, 'Build a futuristic Hyderabad.');
});

test('model and effort can be overridden; Haiku skips effort and fallbacks', async () => {
  const client = fakeClient(ok({ advice: 'Build transit', missions: [] }));
  await createAi({ client, env: { ANTHROPIC_MODEL: 'claude-haiku-4-5' }, logger: quiet }).missions({ landmarks: [] });
  assert.equal(client.calls[0].params.model, 'claude-haiku-4-5');
  assert.equal(client.calls[0].params.output_config.effort, undefined);
  assert.equal(client.calls[0].params.fallbacks, undefined);

  const client2 = fakeClient(ok({ advice: '', missions: [] }));
  await createAi({ client: client2, env: { AI_EFFORT: 'high' }, logger: quiet }).missions({ landmarks: [] });
  assert.equal(client2.calls[0].params.output_config.effort, 'high');
});

test('refusals, truncation and bad output become typed errors', async () => {
  const refusal = createAi({ client: fakeClient(() => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, parsed_output: null })), env: {}, logger: quiet });
  await assert.rejects(refusal.plan('x'), AiRefusalError);

  const truncated = createAi({ client: fakeClient(() => ({ stop_reason: 'max_tokens', parsed_output: null })), env: {}, logger: quiet });
  await assert.rejects(truncated.plan('x'), AiOutputError);

  const invalid = createAi({
    client: fakeClient(() => {
      throw new Anthropic.AnthropicError('Failed to parse structured output');
    }),
    env: {},
    logger: quiet,
  });
  await assert.rejects(invalid.building('a tower', { cityName: 'X', style: 'classic' }), AiOutputError);
});

test('rejected credentials switch the AI off', async () => {
  const ai = createAi({
    client: fakeClient(() => {
      throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers());
    }),
    env: {},
    logger: quiet,
  });
  await assert.rejects(ai.plan('x'), Anthropic.AuthenticationError);
  assert.equal(ai.enabled, false);
  await assert.rejects(ai.plan('x'), AiUnavailableError);
});

test('output schema keeps enums as hard constraints', () => {
  const schema = toOutputSchema(PlanSchema);
  assert.equal(schema.$schema, undefined);
  assert.equal(schema.additionalProperties, false);
  assert.ok(Array.isArray(schema.properties.style.enum));
  const walk = (node) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node.type === 'array') walk(node.items);
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', '$ref']) assert.equal(node[key], undefined, key);
  };
  walk(schema);
});
