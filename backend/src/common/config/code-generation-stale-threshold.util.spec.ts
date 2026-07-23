import { computeCodeGenerationStaleThresholdSec } from './code-generation-stale-threshold.util';

describe('computeCodeGenerationStaleThresholdSec', () => {
  it('computes ceil(baseDelay * (2^retries - 1) * multiplier / 1000)', () => {
    // 200ms * (2^5 - 1) = 6200ms, * 3 = 18600ms -> ceil(18.6s) = 19s
    const result = computeCodeGenerationStaleThresholdSec({
      maxDbRetries: 5,
      retryBaseDelayMs: 200,
      staleSafetyMultiplier: 3,
    });

    expect(result).toBe(19);
  });

  it('rounds up fractional seconds', () => {
    // 100ms * (2^1 - 1) = 100ms, * 1 = 100ms -> ceil(0.1s) = 1s
    const result = computeCodeGenerationStaleThresholdSec({
      maxDbRetries: 1,
      retryBaseDelayMs: 100,
      staleSafetyMultiplier: 1,
    });

    expect(result).toBe(1);
  });

  it('returns 0 when retries is 0 (no backoff window at all)', () => {
    const result = computeCodeGenerationStaleThresholdSec({
      maxDbRetries: 0,
      retryBaseDelayMs: 200,
      staleSafetyMultiplier: 3,
    });

    expect(result).toBe(0);
  });
});
