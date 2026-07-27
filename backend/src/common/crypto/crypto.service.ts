import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * project.api_secret / user.phone_number가 공유하는 AES-256-CBC(Base64) 암호화와
 * S2S HMAC-SHA256 서명 계산/비교를 담당하는 공용 크립토 서비스(09_AUTH_SECURITY.md 2.1).
 *
 * @author trisakion
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  /** ENCRYPTION_KEY(64자 hex, 32바이트) 환경변수를 키로 로드한다. */
  constructor(configService: ConfigService) {
    const hexKey = configService.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = Buffer.from(hexKey, 'hex');
  }

  /**
   * AES-256-CBC로 암호화한다. IV(16바이트)를 암호문 앞에 붙여 하나의 Base64 문자열로
   * 반환한다(테이블 컬럼이 단일 VARCHAR라 별도 컬럼 없이 이렇게 합쳐 저장).
   *
   * @param plaintext - 암호화할 평문
   * @returns `base64(iv + ciphertext)`
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, encrypted]).toString('base64');
  }

  /**
   * {@link encrypt}로 만든 Base64 문자열을 복호화한다.
   *
   * @param ciphertextBase64 - `base64(iv + ciphertext)` 형식의 암호문
   * @returns 복호화된 평문
   */
  decrypt(ciphertextBase64: string): string {
    const buf = Buffer.from(ciphertextBase64, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * HMAC-SHA256 서명을 hex로 계산한다(09_AUTH_SECURITY.md 2.3의 X-API-Signature 계산식).
   *
   * @param secret - 서명에 사용할 비밀키(복호화된 평문 Secret)
   * @param data - 서명 대상 문자열(stringToSign)
   */
  hmacSha256Hex(secret: string, data: string): string {
    return createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * SHA-256 해시를 hex로 계산한다. Refresh Token(opaque UUID) 원문은 저장하지 않고 이 해시값만
   * `user_session.refresh_token_hash`에 저장한다(09_AUTH_SECURITY.md 1.1).
   *
   * @param data - 해시할 원문
   */
  sha256Hex(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * 09_AUTH_SECURITY.md 2.3: 서명 비교는 타이밍 공격 방지를 위해 상수 시간 비교로 수행한다.
   * 길이가 다르면 timingSafeEqual이 예외를 던지므로 그 경우 안전하게 false를 반환한다 —
   * 길이 자체는 비밀값에 의존하지 않으므로 조기 반환이 새 타이밍 사이드채널을 열지 않는다.
   *
   * @param a - 비교할 hex 문자열(예: 서버가 재계산한 서명)
   * @param b - 비교할 hex 문자열(예: 클라이언트가 보낸 X-API-Signature)
   */
  timingSafeEqualHex(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
