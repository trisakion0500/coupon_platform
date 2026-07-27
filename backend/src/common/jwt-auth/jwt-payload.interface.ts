/**
 * Access Token(JWT) 페이로드. 09_AUTH_SECURITY.md 1.6 스펙 그대로 — `exp`/`iat`는
 * `@nestjs/jwt`가 서명 시 자동으로 채워주므로 여기 선언하지 않는다.
 *
 * @author trisakion
 */
export interface JwtPayload {
  jti: string;
  user_id: number;
  company_id: number;
  role_code: number;
}
