# 04_AUTH_SECURITY.md

## 개요

본 문서는 Coupon Platform의 인증/보안 정책을 정의한다. 인증 대상은 두 축으로 나뉜다.

```text
1. 사용자 인증   : 관리 콘솔 사용자 ↔ Coupon Platform API (JWT + user_session)
2. 서버간(S2S) 인증 : 게임서버 → Coupon Platform API (API Key + Secret)
```

세부 엔드포인트/result 코드 스펙은 관리 콘솔 API 설계 시점에 별도 문서로 정리한다(현재 미확정).

---

# 1. 사용자 인증 (JWT + user_session)

## 1.1 토큰 방식

- Access Token: JWT (HS256)
- Refresh Token: UUID v4 형식의 opaque token(페이로드 없음)으로 발급, 원문은 저장하지 않고 SHA-256 해시값만 `user_session.refresh_token_hash`에 저장
- Access Token의 `jti`를 `user_session.access_token_jti`로 관리(UNIQUE) — refresh 시마다 갱신되어 이전 access token 무효화

#### Access Token(JWT)과 달리 opaque(UUID)인 이유

- **검증 방식이 이미 DB 조회를 전제로 함**: Access Token 재발급 처리는 `user_session`을 무조건 조회해 `status`/`expired_at`을 확인하고 `access_token_jti`를 갱신한다. 어차피 DB round-trip이 필수라 JWT의 핵심 장점(서명 검증만으로 DB 없이 자체 검증)이 refresh token에는 의미가 없다.
- **즉시 폐기(revocation) 요구**: 로그아웃·비밀번호 변경 시 모든 세션을 즉시 종료해야 하는데, 스테이트리스한 JWT는 만료 전 무효화에 별도 블랙리스트가 필요하다. opaque token을 해시해 `refresh_token_hash`로 저장해두면 그 행을 지우거나 status를 바꾸는 것만으로 즉시 무효화된다.
- **정보 노출 최소화**: JWT는 서명 검증 없이도 payload를 누구나 디코딩할 수 있다. Refresh token은 access token(15분)보다 수명이 훨씬 길어(7일) 탈취 시 파급력이 큰데, opaque 랜덤값은 그 자체로는 아무 정보도 담지 않아 서버 조회 없이는 무의미하다.

즉 Access Token은 stateless 검증이 필요해 JWT를, Refresh Token은 어차피 stateful 검증을 거치므로 opaque UUID를 쓰는 역할 분리다.

## 1.2 토큰 만료 정책

```text
Access Token 만료시간  : 15분 (JWT_ACCESS_EXPIRES_IN 기본값)
Refresh Token 만료시간 : 7일  (JWT_REFRESH_EXPIRES_IN 기본값)
```

## 1.3 세션 상태 관리

- 로그인 시 `user_session` 행 INSERT
- 로그아웃/만료 시 `status`만 변경(UPDATE), DELETE하지 않음 → 그대로 두면 행이 무한정 누적되므로 배치로 정리
  - 주기: `SESSION_CLEANUP_CRON` (기본 `0 4 * * *`, 매일 새벽 4시)
  - 대상: `expired_at`이 현재 시각보다 과거인 세션(`status` 무관), 물리 삭제
- `user_session.user_id`는 FK를 의도적으로 적용하지 않음(추후 Redis 전환 대비, [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) 참고)
- `user.status`와 세션 상태는 별도로 관리되나, 아래 두 경우에는 해당 사용자의 모든 활성 세션(`status = 1`)을 즉시 종료(`status = 0`)한다
  - 사용중지(`user.status = 3`) 처리 시
  - 비밀번호 변경 시

## 1.4 요청 제한(Rate Limit) 정책

인증 없이 호출 가능한 API 중 반복 요청 시 브루트포스 피해가 있는 로그인/회원가입 엔드포인트에 IP 기준 요청 제한을 적용한다.

```text
기준   : IP당 windowMs 동안 max회 (기본 15분/10회, LOGIN_RATE_LIMIT_WINDOW_MS/LOGIN_RATE_LIMIT_MAX)
초과 시 : 429 Too Many Requests
```

Access Token 재발급 엔드포인트는 유효한 refresh token 보유가 전제되어야 해 대상에서 제외한다.

## 1.5 인증 검증 순서 (원칙)

```text
1. Authorization 헤더 존재 여부 확인
2. Access Token 유효성 검증 (서명/만료)
3. Session 확인 (user_session.status = 1)
4. User 상태 확인 (user.status = 1 : 가입승인)
```

## 1.6 JWT Payload 및 역할 스코핑

### Access Token Payload

```json
{
  "jti": "uuid-v4",
  "user_id": 1,
  "company_id": 1,
  "role_code": 20,
  "exp": 1234567890,
  "iat": 1234567890
}
```

| 필드       | 설명                                         |
| ---------- | -------------------------------------------- |
| jti        | Token 고유 식별자 (UUID v4). Session 조회 키 |
| user_id    | 사용자 ID                                    |
| company_id | 소속 회사 ID                                 |
| role_code  | 역할 코드 (10/20/30/40)                      |
| exp        | 만료 시각 (Unix timestamp)                   |
| iat        | 발급 시각 (Unix timestamp)                   |

### role_code 계산 규칙

`role_code`는 `user` 테이블의 고정 컬럼이 아니라, 로그인 시점에 `user_role`(사용자×프로젝트 역할 매핑)을 조인해 계산되는 값이다.

```text
role_code = MIN(user_role.role_code) WHERE user_id = ? AND status = 1
            배정된 활성 user_role이 없으면 40(OPERATOR)
```

사용자가 프로젝트마다 다른 역할을 가질 수 있으므로(A 프로젝트 DEVELOPER, B 프로젝트 OPERATOR 등), JWT의 `role_code`는 그중 최고 권한 하나일 뿐이다. 그래서 `project_id`를 특정하는 쓰기 API는 라우트 단의 역할 검사와 별도로, 요청마다 대상 `project_id`에 대한 실제 `user_role`을 다시 조회해 검증해야 한다 — 세부 검증 방식은 관리 콘솔 API 설계 시점에 확정.

#### 기본값이 40(OPERATOR)인 이유

역할 코드는 `10 < 20 < 30 < 40` 순으로 숫자가 클수록 권한이 낮다. 배정된 `user_role`이 없을 때 10/20/30 중 하나를 기본값으로 삼으면 어떤 프로젝트에도 배정되지 않은 사용자가 관리자·개발자·매니저 권한을 자동으로 갖게 되는 권한 상승 결함이 생긴다. 40은 코드 체계상 가장 낮은 권한이므로, 미배정 사용자를 가장 안전한 최소 권한으로 취급하는 fail-safe 기본값이다.

#### 미배정이 실제로 발생하는 경우

`company_id`는 가입 시 필수 입력이라 항상 값이 있지만, 프로젝트별 역할(`user_role`)은 완전히 별도 절차로 배정된다. 회원가입 처리는 `user` 테이블에만 INSERT하고, 가입 승인 처리도 `user.status`만 변경할 뿐 `user_role`은 건드리지 않는다 — SUPER_ADMIN이 프로젝트별 역할을 별도로 배정해야 한다. 따라서 다음 두 경우 실제로 `role_code`가 40으로 계산된다.

```text
1. 가입 승인 직후 ~ 역할 배정 전 : 로그인은 가능하나 user_role 행이 0개
2. 배정된 user_role이 모두 status=0(비활성) 처리된 경우
```

이 상태에서는 회사는 있지만 연결된 프로젝트가 없어, 프로젝트 단위로 스코핑되는 화면/API에는 아무것도 표시되지 않는다.

### company_id 스코핑 규칙

```text
role_code = 10 (SUPER_ADMIN) : company_id 무시, 모든 회사 접근 가능
그 외                        : company_id 소속 회사 데이터만 접근 가능
```

## 1.7 강제 로그아웃 정책

아래 상황에서는 관리자가 특정 사용자의 모든 활성 세션을 강제로 종료할 수 있다.

```text
관리자 강제 로그아웃
비밀번호 유출 의심
보안 사고 대응
```

처리

```sql
UPDATE user_session
SET status = 0
WHERE user_id = ?
  AND status = 1
```

---

# 2. 서버간(S2S) 인증 (게임서버 → Coupon Platform)

## 2.1 인증 방식

- `project.api_key` + `project.api_secret_hash`(SHA-256 해시) 기반
- Secret 원문은 발급 시점에만 노출, 이후 해시값만 저장/비교

## 2.2 Secret Rotation (Grace Period 방식)

- Secret 재발급 시 기존 해시를 `api_secret_hash_prev`로 이동, 신규 해시를 `api_secret_hash`에 저장
- `secret_rotated_at`에 재발급 시각 기록
- 유예기간(`API_SECRET_GRACE_PERIOD_DAYS`) 동안은 `api_secret_hash`/`api_secret_hash_prev` 둘 다 유효한 것으로 검증
- 유예기간 경과 후 배치가 `api_secret_hash_prev`를 `NULL` 처리

## 2.3 미확정 사항

- 요청 서명 방식(단순 헤더 대조 vs HMAC 서명) — 최종 확정 전
- 유예기간 배치 실행 주기
- Secret 발급/재발급 API 자체의 인증 주체(관리 콘솔 사용자 권한 범위)

---

# 3. 비밀번호 정책

- `user.password_hash`: bcrypt(rounds=12)

---

# 4. 관련 문서

- 테이블 구조: [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md)
