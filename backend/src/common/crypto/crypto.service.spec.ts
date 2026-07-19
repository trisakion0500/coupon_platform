import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

function buildConfigService(): ConfigService {
  const key = randomBytes(32).toString('hex');
  return { getOrThrow: jest.fn(() => key) } as unknown as ConfigService;
}

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService(buildConfigService());
  });

  describe('encrypt/decrypt', () => {
    it('round-trips a plaintext value', () => {
      const plaintext = 'super-secret-value';
      const encrypted = service.encrypt(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('produces different ciphertext each time due to random IV, but decrypts to the same plaintext', () => {
      const a = service.encrypt('hello');
      const b = service.encrypt('hello');

      expect(a).not.toBe(b);
      expect(service.decrypt(a)).toBe('hello');
      expect(service.decrypt(b)).toBe('hello');
    });
  });

  describe('hmacSha256Hex', () => {
    it('is deterministic for the same secret/data', () => {
      const sig1 = service.hmacSha256Hex('secret', 'data');
      const sig2 = service.hmacSha256Hex('secret', 'data');
      expect(sig1).toBe(sig2);
    });

    it('changes when the data changes', () => {
      const sigA = service.hmacSha256Hex('secret', 'data-a');
      const sigB = service.hmacSha256Hex('secret', 'data-b');
      expect(sigA).not.toBe(sigB);
    });
  });

  describe('timingSafeEqualHex', () => {
    it('returns true for identical hex strings', () => {
      const sig = service.hmacSha256Hex('secret', 'data');
      expect(service.timingSafeEqualHex(sig, sig)).toBe(true);
    });

    it('returns false for different hex strings of equal length', () => {
      const sigA = service.hmacSha256Hex('secret', 'data-a');
      const sigB = service.hmacSha256Hex('secret', 'data-b');
      expect(service.timingSafeEqualHex(sigA, sigB)).toBe(false);
    });

    it('returns false (does not throw) when lengths differ', () => {
      expect(() => service.timingSafeEqualHex('ab', 'abcd')).not.toThrow();
      expect(service.timingSafeEqualHex('ab', 'abcd')).toBe(false);
    });
  });
});
