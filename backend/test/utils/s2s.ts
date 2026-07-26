import { createHmac, randomUUID } from 'crypto';

/** S2S 인증에 필요한 project별 자격증명(관리 콘솔 API로 발급받은 평문 값). */
export interface S2sCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * `S2sAuthGuard.buildStringToSign`(backend/src/common/s2s-auth/s2s-auth.guard.ts)과 정확히
 * 동일한 규칙으로 stringToSign을 구성하고 HMAC-SHA256 서명을 계산해 4개 S2S 인증 헤더를
 * 만든다(07_AUTH_SECURITY.md 2.3). `rawQuery`/`bodyString`은 실제로 전송할 값과 바이트 단위로
 * 동일해야 한다 — 호출부가 supertest에 넘기는 값과 반드시 같은 문자열을 넘길 것.
 *
 * @param method - HTTP 메서드(대문자, 예: 'POST')
 * @param path - 쿼리스트링을 제외한 URL 경로(예: '/v1/coupons/ABCD/reserve')
 * @param rawQuery - `?` 뒤 쿼리스트링 원문(없으면 빈 문자열)
 * @param bodyString - 요청 바디 원문(GET 등 바디가 없으면 빈 문자열)
 *
 * @author trisakion
 */
export function buildS2sHeaders(
  credentials: S2sCredentials,
  method: string,
  path: string,
  rawQuery: string,
  bodyString: string,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const stringToSign = [
    method,
    path,
    rawQuery,
    timestamp,
    nonce,
    bodyString,
  ].join('\n');
  const signature = createHmac('sha256', credentials.apiSecret)
    .update(stringToSign)
    .digest('hex');

  return {
    'X-API-Key': credentials.apiKey,
    'X-API-Timestamp': timestamp,
    'X-API-Nonce': nonce,
    'X-API-Signature': signature,
  };
}
