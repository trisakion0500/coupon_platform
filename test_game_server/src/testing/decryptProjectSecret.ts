import { createDecipheriv } from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

const key = Buffer.from(config.encryptionKey, 'hex');

/**
 * `project.api_secret`/`api_secret_prev` 암호문(`base64(iv + ciphertext)`)을 평문으로 복호화한다.
 * backend `CryptoService.decrypt`와 동일한 알고리즘(AES-256-CBC)을 독립적으로 재구현한 것 —
 * `src/sdk/CouponS2sClient.ts`는 이 로직을 전혀 모른다(9.2 캐비어트, 평문만 SDK에 넘긴다).
 *
 * 이 도구가 `ENCRYPTION_KEY`를 알고 있다는 것 자체가 실제 게임서버라면 있을 수 없는 일이다 —
 * 순수 테스트 편의를 위한 것이며, 로컬 개발 DB에서만 써야 한다(docs/20_TEST_GAME_SERVER.md 2.3).
 */
export function decryptProjectSecret(ciphertextBase64: string): string {
  const buf = Buffer.from(ciphertextBase64, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
