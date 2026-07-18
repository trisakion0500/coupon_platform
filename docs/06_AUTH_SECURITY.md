# 06_AUTH_SECURITY.md

## 개요

본 문서는 Coupon Platform의 인증/보안 정책을 정의한다. 인증 대상은 두 축으로 나뉜다.

```text
1. 사용자 인증   : 관리 콘솔 사용자 ↔ Coupon Platform API (JWT + user_session)
2. 서버간(S2S) 인증 : 게임서버 → Coupon Platform API (API Key + HMAC-SHA256 요청 서명)
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

- **HMAC-SHA256 요청 서명** 방식을 채택한다 — Secret 원문 자체는 요청에 실리지 않고, Secret으로 서명한 값만 매 요청마다 전송한다
- `project.api_key`로 프로젝트를 식별하고, `project.api_secret`(AES-256-CBC 암호화, Base64)을 복호화해 서명 검증에 사용한다
- Secret 저장 방식이 단방향 해시가 아니라 **가역 암호화**인 이유: 서버가 요청마다 클라이언트가 보낸 서명을 재계산해서 대조해야 하는데, 단방향 해시로는 원문을 복원할 수 없어 서명 재계산 자체가 불가능하다. `user.phone_number`와 동일한 AES-256-CBC(`ENCRYPTION_KEY`)를 재사용한다(전용 키를 별도로 두지 않음 — 이미 앱에 reversible 암호화 인프라가 있고, 별도 키 관리 비용을 늘릴 만큼 위협 모델이 다르지 않다고 판단)
- 평문 Secret이 API 응답에 노출되는 시점(발급/재발급 1회)은 기존과 동일하다 — 이 절의 변경은 **저장/검증 방식**에 관한 것이지, Secret 노출 정책에 관한 것이 아니다

### 왜 단순 헤더 대조(정적 Key+Secret 전송) 대신 HMAC인가

단순히 `X-API-Secret` 헤더로 원문을 매번 실어보내고 서버가 해시 대조만 하는 방식도 검토했다(그 경우 `api_secret_hash`를 그대로 단방향 해시로 유지할 수 있어 스키마 변경이 필요 없다). 다만 이 방식은 두 가지 약점이 있다.

1. Secret 원문이 리버스프록시/APM 로깅 등 TLS 밖의 경로로 새면 재발급 전까지 영구적으로 유효한 자격증명이 그대로 유출된다
2. Timestamp 윈도우만으로는 완전한 재전송 차단이 안 된다 — 캡처한 요청을 윈도우 시간 내에 그대로 재전송하는 것 자체는 막지 못하고 "재전송 가능한 시간"만 제한할 뿐이다. 이 경우 FIXED 코드 + `use_limit_per_user > 1` 조합에서 재전송으로 보상이 중복 지급될 수 있다([05_COUPON_USAGE_SCENARIO.md](./05_COUPON_USAGE_SCENARIO.md) 4장 참고)

재화(쿠폰 보상) 지급이 걸린 API라 이 잔여 위험을 감수하지 않기로 하고, Secret을 가역 암호화로 바꾸는 스키마 비용을 들여서라도 HMAC + nonce로 재전송을 원천 차단하는 쪽을 택했다.

## 2.2 요청 헤더 스펙

게임서버는 [17_COUPON_USAGE_API.md](./17_COUPON_USAGE_API.md)의 모든 엔드포인트 호출 시 아래 헤더를 포함해야 한다. Secret 원문은 어떤 헤더에도 실리지 않는다.

| 헤더 | 필수 | 설명 |
|---|---|---|
| `X-API-Key` | Y | `project.api_key` |
| `X-API-Timestamp` | Y | 요청 생성 시각, Unix Epoch 초 단위 정수 문자열(예: `1721270400`) |
| `X-API-Nonce` | Y | 요청마다 새로 생성하는 1회성 임의 문자열(형식 강제 없음, 예: UUID v4). 재전송 방지에 사용(2.5 참고) |
| `X-API-Signature` | Y | 2.3의 서명 대상 문자열을 Secret으로 HMAC-SHA256 서명한 값(hex) |

[07_API_COMMON.md](./07_API_COMMON.md) 4장의 날짜/시간 포맷(`YYYY-MM-DD HH:mm:ss`) 정책은 요청/응답 **바디**에 대한 것이고, `X-API-Timestamp`는 인증 헤더라 그 정책과 무관하게 Unix Epoch 초를 사용한다 — 윈도우 비교가 문자열 파싱 없이 정수 비교로 끝나야 하기 때문이다.

## 2.3 서명 생성 규칙

서명 대상 문자열(string to sign)은 다음과 같이 구성한다.

```text
stringToSign = HTTP_METHOD + "\n"
             + PATH (쿼리스트링 제외) + "\n"
             + RAW_QUERY_STRING (없으면 빈 문자열) + "\n"
             + X-API-Timestamp + "\n"
             + X-API-Nonce + "\n"
             + RAW_BODY (없으면 빈 문자열, JSON 원문 그대로 — 파싱 후 재직렬화 금지)

X-API-Signature = HMAC-SHA256(secret, stringToSign)  // hex 인코딩
```

- 쿼리스트링(`GET /coupons/unconfirmed` 등)까지 서명 대상에 포함시키는 이유: 그렇지 않으면 서명은 그대로 두고 쿼리 파라미터(`game_user_id` 등)만 바꿔치기하는 변조가 가능해진다
- `RAW_BODY`를 파싱 후 재직렬화하지 않고 원문 그대로 서명에 사용해야 한다 — JSON 키 순서/공백 차이로 서버가 재직렬화한 문자열이 클라이언트가 서명한 문자열과 달라지면 정상 요청도 서명 불일치로 거부된다
- 서명 비교는 타이밍 공격을 막기 위해 상수 시간 비교(Node.js `crypto.timingSafeEqual`)로 수행한다

## 2.4 인증 검증 순서

```text
1. 필수 헤더(X-API-Key/X-API-Timestamp/X-API-Nonce/X-API-Signature) 존재 및 형식 확인
   (X-API-Timestamp가 정수로 파싱되는지 포함) — 실패 시 10012
2. X-API-Timestamp 허용범위 확인: |NOW() - timestamp| <= S2S_TIMESTAMP_TOLERANCE_SEC
   (과거/미래 양방향 검사 — 서버 시각만으로 끝나는 값싼 검사라 DB 조회 전에 먼저 수행) — 실패 시 10013
3. X-API-Key로 project 조회 — 실패 시 10010
4. project.status 확인 (0:중지) — 실패 시 10014
5. project.api_secret(및 유예기간 내 api_secret_prev) 복호화 후 2.3의 stringToSign으로 서명 재계산,
   X-API-Signature와 상수 시간 비교 — 두 Secret 중 어느 쪽과도 불일치하면 10011
6. (project_id, X-API-Nonce)로 project_api_nonce에 INSERT 시도 — UNIQUE 위반(이미 사용된 nonce)이면
   재전송으로 판단해 10015 (2.5 참고)
7. 모두 통과 — project_id 확정, 이후 요청 처리로 진행
```

서명 검증(5번)을 nonce 등록(6번)보다 먼저 하는 이유: 순서를 바꾸면 서명이 아예 틀린 요청도 nonce 테이블에 행을 남기게 되어, 인증되지 않은 요청으로 테이블만 불필요하게 채우는 것을 막기 위함이다.

## 2.5 Nonce 저장 및 재전송(Replay) 방지

- `project_api_nonce` 테이블(`database/tables/project_api_nonce.sql`)에 `(project_id, nonce)` UNIQUE 제약으로 1회성을 보장한다 — INSERT 자체의 유니크 제약 위반을 이용하므로 동시에 같은 nonce가 들어와도 원자적으로 하나만 성공한다
- 보관 기간은 `S2S_TIMESTAMP_TOLERANCE_SEC`만큼이면 충분하다 — 그 범위를 벗어난 요청은 2.4의 2번 단계(Timestamp 허용범위)에서 이미 거부되므로, 그 이후에는 같은 nonce가 다시 와도 위협이 되지 않는다
- 정리 배치(`S2S_NONCE_CLEANUP_CRON`, 기본 `*/10 * * * *` — 10분 간격)가 `created_at`이 `NOW() - S2S_TIMESTAMP_TOLERANCE_SEC`보다 과거인 행을 물리 삭제한다. `SESSION_CLEANUP_CRON`(1일 1회)보다 훨씬 잦은 이유는 reserve/confirm 트래픽이 호출마다 1행씩 쌓여 테이블이 빠르게 커질 수 있기 때문이다

## 2.6 Secret Rotation (Grace Period 방식)

- Secret 재발급 시 기존 암호화값을 `api_secret_prev`로 이동, 신규 암호화값을 `api_secret`에 저장
- `secret_rotated_at`에 재발급 시각 기록
- 유예기간(`API_SECRET_GRACE_PERIOD_DAYS`) 동안은 `api_secret`/`api_secret_prev` 둘 다 복호화해 서명 검증에 사용(2.4의 5번 — 어느 한쪽과만 일치해도 통과)
- 유예기간 경과 후 배치(`API_SECRET_CLEANUP_CRON`, 기본 `0 5 * * *`)가 `secret_rotated_at + API_SECRET_GRACE_PERIOD_DAYS`가 지난 `api_secret_prev`를 `NULL` 처리 — `SESSION_CLEANUP_CRON`과 동일하게 서버 기동 시 `node-cron`으로 등록
- Secret 발급(프로젝트 생성 시)/재발급 API 자체의 인증 주체는 관리 콘솔 사용자(SUPER_ADMIN/DEVELOPER)다 — [10_PROJECT_API.md](./10_PROJECT_API.md) 2.1/2.5 참고. 그 API들은 이 절의 S2S 인증과는 별개로 JWT 기반 사용자 인증(1장)을 그대로 따른다

## 2.7 API 버전 관리

S2S API(게임서버가 호출하는 쿠폰 발급/사용 관련 엔드포인트)는 버전 관리 대상이다. 게임서버(테넌트)마다 연동 시점이 달라, 쿠폰 서버의 배포 주기가 특정 게임서버의 대응 여부에 묶이면 안 되기 때문이다.

```text
대상    : S2S API만 해당 (관리 콘솔 API는 버전 없음 — 프론트/백을 같은 팀이 동시 배포하므로 불필요)
방식    : NestJS 내장 URI Versioning (app.enableVersioning({ type: VersioningType.URI }))
URL 패턴 : /v1/coupons/reserve, /v1/coupons/confirm 등
운영 규칙 : v1으로 시작, breaking change 발생 시 v2 컨트롤러를 추가하고 기존 v1 라우트는 유지
```

---

# 3. 비밀번호 정책

- `user.password_hash`: bcrypt(rounds=12)

---

# 4. 관련 문서

- 테이블 구조: [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md)
