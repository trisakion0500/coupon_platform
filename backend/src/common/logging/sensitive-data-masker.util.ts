/**
 * HTTP 요청/응답 로그에 민감정보가 그대로 찍히지 않도록 재귀적으로 마스킹한다.
 * `02_DEV_CONVENTIONS.md` 1.1 — 요청 바디/응답 바디/헤더 전부 이 함수를 거쳐야 한다.
 *
 * @author trisakion
 */
const SENSITIVE_KEYS = new Set(
  [
    'password',
    'new_password',
    'old_password',
    'current_password',
    'password_hash',
    'phone_number',
    'access_token',
    'refresh_token',
    'api_secret',
    'api_secret_prev',
    'authorization',
    'x-api-signature',
  ].map((key) => key.toLowerCase()),
);

const MASK = '***';

/** 값 하나가 마스킹 대상 키에 해당하는지(대소문자 무시). */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * 객체/배열을 재귀적으로 순회하며 민감 키의 값을 `***`로 치환한 새 값을 반환한다.
 * 원본은 변경하지 않는다(로그용 사본). 순환 참조는 이 프로젝트의 로그 대상(DTO/plain object)에서는
 * 발생하지 않는 전제라 별도 방어는 두지 않는다.
 */
export function maskSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveData(item));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = isSensitiveKey(key) ? MASK : maskSensitiveData(nested);
    }
    return result;
  }

  return value;
}
