import { it, expect } from 'vitest';
import { priceFromEnv, evaluationOptionsFromEnv } from '../src/evaluations/config.js';
it('keeps empty tariffs unknown, rejects partial rates, accepts explicit zeros', () => {
  expect(
    priceFromEnv({
      AI_INPUT_USD_PER_MILLION: ' ',
      AI_OUTPUT_USD_PER_MILLION: '',
      AI_THINKING_USD_PER_MILLION: '',
    }),
  ).toBeUndefined();
  expect(() => priceFromEnv({ AI_INPUT_USD_PER_MILLION: '1' })).toThrow('three');
  expect(
    priceFromEnv({
      AI_INPUT_USD_PER_MILLION: '0',
      AI_OUTPUT_USD_PER_MILLION: '0',
      AI_THINKING_USD_PER_MILLION: '0',
    }),
  ).toMatchObject({
    inputPerMillion: 0,
    outputPerMillion: 0,
    thinkingPerMillion: 0,
    outputIncludesThinking: false,
  });
});
it('keeps v4 default and rejects unsupported hard budget mode', () => {
  expect(evaluationOptionsFromEnv({}).candidate).toBe(false);
  expect(evaluationOptionsFromEnv({ AI_EVALUATION_POLICY: 'facts-first-v1' }).candidate).toBe(true);
  expect(() => evaluationOptionsFromEnv({ AI_HARD_BUDGET_USD: '1' })).toThrow('reservation');
});
