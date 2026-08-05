# 09_AUTH_SECURITY.md

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
- `user_session.user_id`는 FK를 의도적으로 적용하지 않음(추후 Redis 전환 대비 — 1.3.1의 세션 검증 캐시가 그 활용 사례, [06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md) 참고)
- `user.status`와 세션 상태는 별도로 관리되나, 아래 세 경우에는 해당 사용자의 모든 활성 세션(`status = 1`)을 즉시 종료(`status = 0`)한다
  - 사용중지(`user.status = 3`) 처리 시
  - 비밀번호 변경 시(본인 변경/관리자 초기화 둘 다)
  - (아래 1.3.1의 Redis 캐시가 활성화된 경우) 위 두 경우 및 로그아웃 시 해당 유저의 캐시된 세션도 함께 무효화

### 1.3.1 세션 검증 읽기 캐시 (Redis, 2026-08-05 도입, 선택)

`REDIS_ENABLED=true`면 1.5의 3번째 단계(Session 확인, `SP_USER_SESSION_VALIDATE_BY_JTI` 호출)를 `SessionCacheService`가 캐싱한다 — DB는 여전히 source of truth이고 Redis는 순수 읽기 캐시다(2.5의 nonce처럼 "Redis 우선/DB 폴백" 구조가 아니다). 목적은 매 인증된 요청마다 도는 이 DB 조회의 부하를 줄이는 것.

- **캐시 대상**: 검증 성공(`user_status=1`) 케이스만 `session:jti:{jti}` 키에 `{userId, companyId, generation}`으로 저장(TTL=`SESSION_CACHE_TTL_SEC`, 기본 60초). 실패 케이스(0/2/3)는 캐싱하지 않는다.
- **무효화 — 유저 단위 generation 카운터**: jti별 캐시를 개별 삭제하는 대신, `session:gen:{userId}` 카운터(TTL=`SESSION_CACHE_GENERATION_TTL_SEC`, 기본 120초)를 둬서 로그아웃/비밀번호변경(변경·초기화)/계정정지 시 이 카운터만 올린다(`SessionCacheService.invalidateUser`). 캐시 조회 시 "캐시된 generation == 현재 generation"이 같을 때만 히트로 인정 — 카운터 하나만 올리면 그 유저의 캐시된 세션이 몇 개(여러 기기)든 다음 조회 시점에 한꺼번에 미스로 전환된다. `session:jti:{jti}`(캐시 엔트리)와 `session:gen:{userId}`(카운터)는 같은 `session:` 트리 아래 종류별로 나뉘어 있지만, 캐시 엔트리에 담긴 `generation` 필드는 write 시점의 스냅샷일 뿐 이 카운터 자체가 아니다 — 무효화는 항상 이 카운터 하나만 갱신하고, 모든 jti 엔트리가 조회 때마다 자기 스냅샷을 이 카운터와 비교한다.
- **카운터 TTL이 캐시 TTL보다 반드시 커야 한다**: 카운터가 캐시보다 먼저 만료돼 0으로 리셋되면, 아직 살아있는 옛 캐시 항목(리셋 이전 값으로 캐싱된)의 generation과 우연히 일치해버려 무효화가 원상복구되는 보안 구멍이 생긴다. `env.validation.ts`가 부팅 시점에 `SESSION_CACHE_GENERATION_TTL_SEC > SESSION_CACHE_TTL_SEC`를 강제해, 이 관계를 어긴 설정은 서버가 뜨지 않는다.
- **`refresh()`(jti 회전)는 generation이 아니라 정밀 삭제**: 재발급 시 이전 jti는 그 즉시 무효여야 하는데(11_AUTH_API.md 7장), generation bump는 그 유저의 다른 기기 세션까지 전부 캐시 미스를 만들어 불필요하게 넓다 — 대신 `SP_USER_SESSION_GET_BY_REFRESH_HASH`가 회전 전 `access_token_jti`를 함께 반환하도록 해, `evictJti`로 그 jti의 캐시 항목 하나만 정밀 삭제한다.
- Redis 미스/에러는 항상 안전하게 기존 DB 경로로 떨어진다 — 캐시가 통째로 죽어도(예: `REDIS_ENABLED=false`) 인증 자체는 순수 DB 경로로 완전히 동일하게 동작한다.
- **알려진 한계(2026-08-05 동시성 감사에서 발견, 완전히 닫을 수는 없음)**: DB 검증 성공 시점과 캐시 write 시점 사이에는 구조적 갭이 있다(캐시하려면 DB가 반환한 `userId`가 있어야 해서, generation을 DB 검증보다 먼저 읽을 방법이 없다) — 그 사이 같은 유저의 무효화가 끼어들면 방금 무효화된 세션을 오히려 새로 캐싱해버릴 수 있다. MySQL과 Redis가 물리적으로 다른 시스템이라 진짜 트랜잭션으로 묶어 완전히 닫을 수는 없고, `SessionCacheService.cacheSession`이 write 직후 generation을 한 번 더 읽어 그 사이 바뀌었으면 즉시 삭제하는 이중 확인으로 창을 "DB 왕복 1회" 수준에서 "Redis 명령 1회" 수준으로 좁히는 완화만 적용돼 있다. 최악의 경우도 `SESSION_CACHE_TTL_SEC`로 상한이 걸려 무한정 유효해지지는 않는다. `refresh()`의 `evictJti`(단순 키 삭제, generation과 무관)는 같은 방식의 완화조차 적용할 수 없는 별개의 레이스가 남아있으나, 권한 상승 위험 없이 "같은 유저의 여전히 유효한 세션이 옛 jti로 잠깐 더 도는" 수준이라 심각도가 낮아 의도적으로 손대지 않았다.

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
3. Session 확인 (user_session.status = 1) — REDIS_ENABLED=true면 1.3.1의 캐시를 먼저 확인,
   히트면 이 단계와 4번을 건너뛰고 바로 통과(캐시는 검증 성공 케이스만 저장하므로 재확인 불필요)
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
2. Timestamp 윈도우만으로는 완전한 재전송 차단이 안 된다 — 캡처한 요청을 윈도우 시간 내에 그대로 재전송하는 것 자체는 막지 못하고 "재전송 가능한 시간"만 제한할 뿐이다. 이 경우 FIXED 코드 + `use_limit_per_user > 1` 조합에서 재전송으로 보상이 중복 지급될 수 있다([08_COUPON_USAGE_SCENARIO.md](./08_COUPON_USAGE_SCENARIO.md) 4장 참고)

재화(쿠폰 보상) 지급이 걸린 API라 이 잔여 위험을 감수하지 않기로 하고, Secret을 가역 암호화로 바꾸는 스키마 비용을 들여서라도 HMAC + nonce로 재전송을 원천 차단하는 쪽을 택했다.

## 2.2 요청 헤더 스펙

게임서버는 [20_COUPON_USAGE_API.md](./20_COUPON_USAGE_API.md)의 모든 엔드포인트 호출 시 아래 헤더를 포함해야 한다. Secret 원문은 어떤 헤더에도 실리지 않는다.

| 헤더 | 필수 | 설명 |
|---|---|---|
| `X-API-Key` | Y | `project.api_key` |
| `X-API-Timestamp` | Y | 요청 생성 시각, Unix Epoch 초 단위 정수 문자열(예: `1721270400`) |
| `X-API-Nonce` | Y | 요청마다 새로 생성하는 1회성 임의 문자열(형식 강제 없음, 예: UUID v4). 재전송 방지에 사용(2.5 참고) |
| `X-API-Signature` | Y | 2.3의 서명 대상 문자열을 Secret으로 HMAC-SHA256 서명한 값(hex) |

[10_API_COMMON.md](./10_API_COMMON.md) 4장의 날짜/시간 포맷(`YYYY-MM-DD HH:mm:ss`) 정책은 요청/응답 **바디**에 대한 것이고, `X-API-Timestamp`는 인증 헤더라 그 정책과 무관하게 Unix Epoch 초를 사용한다 — 윈도우 비교가 문자열 파싱 없이 정수 비교로 끝나야 하기 때문이다.

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

- `RAW_QUERY_STRING`까지 서명 대상에 포함시키는 이유: 그렇지 않으면 서명은 그대로 두고 쿼리 파라미터만 바꿔치기하는 변조가 가능해진다 — 현재 3개 엔드포인트(reserve/confirm/unconfirmed)는 전부 POST+바디라 실제로 쿼리스트링을 쓰는 곳은 없지만(`unconfirmed`도 2026-07-27부터 POST — 파라미터가 URL에 남아 접근 로그에 그대로 찍히는 걸 피하려는 목적), 이 필드 자체는 향후 GET 엔드포인트가 추가될 가능성을 대비해 그대로 유지한다
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
6. (project_id, X-API-Nonce)를 원자적으로 등록 시도(Redis 우선, 장애 시 DB로 fail-open 폴백) — 이미
   사용된 nonce면 재전송으로 판단해 10015 (2.5 참고)
7. 모두 통과 — project_id 확정, 이후 요청 처리로 진행
```

서명 검증(5번)을 nonce 등록(6번)보다 먼저 하는 이유: 순서를 바꾸면 서명이 아예 틀린 요청도 nonce 테이블에 행을 남기게 되어, 인증되지 않은 요청으로 테이블만 불필요하게 채우는 것을 막기 위함이다.

## 2.5 Nonce 저장 및 재전송(Replay) 방지

**저장소는 이중 경로다(2026-08-05, Redis 도입 1단계)**: `REDIS_ENABLED=true`면 Redis가 1차 경로, 기존 MySQL(`project_api_nonce`)이 fail-open 폴백 경로다.

- **Redis 경로(정상 상태)**: `RedisService.setNx`가 `SET nonce:{project_id}:{nonce} '1' EX <S2S_TIMESTAMP_TOLERANCE_SEC> NX`를 실행한다. 성공하면 신규 nonce, 실패(키가 이미 존재)하면 재전송으로 판단해 10015 — 이 경우는 DB로 폴백하지 않는다(Redis가 정상적으로 응답한 결과이지 장애가 아니므로). TTL이 곧 `S2S_TIMESTAMP_TOLERANCE_SEC`이라 별도 정리 배치가 필요 없다.
- **DB 폴백 경로(Redis 장애 시)**: Redis 커맨드 자체가 실패하면(연결 끊김/타임아웃) `S2sAuthGuard`가 이를 잡아 기존 `project_api_nonce` 테이블(`database/tables/project_api_nonce.sql`)에 `(project_id, nonce)` UNIQUE 제약으로 INSERT하는 경로로 넘어간다 — INSERT 자체의 유니크 제약 위반을 이용하므로 동시에 같은 nonce가 들어와도 원자적으로 하나만 성공한다. 보관 기간은 `S2S_TIMESTAMP_TOLERANCE_SEC`만큼이면 충분하다(그 범위를 벗어난 요청은 2.4의 2번 단계에서 이미 거부됨). 정리 배치(`S2S_NONCE_CLEANUP_CRON`, 기본 `*/10 * * * *`)가 `created_at`이 `NOW() - S2S_TIMESTAMP_TOLERANCE_SEC`보다 과거인 행을 물리 삭제한다 — **이 배치는 `REDIS_ENABLED` 여부와 무관하게 항상 실행된다**, Redis가 정상일 때도 장애 순간에 DB에 기록될 수 있기 때문이다.
- **알려진 한계(fail-open의 부수 효과)**: Redis가 짧게 끊겼다 복구되는 사이(flapping) 같은 nonce의 요청1이 Redis 경로로, 재전송인 요청2가 DB 경로로 각각 착지하면 이론상 재전송이 통과할 수 있다. `S2S_TIMESTAMP_TOLERANCE_SEC`(기본 300초) 창이 좁고 이 조합 자체가 흔치 않아 감수하기로 한 트레이드오프다 — 가용성을 우선하고 이중 경로 간 완전한 일관성은 보장하지 않기로 한 설계다.

## 2.6 Secret Rotation (Grace Period 방식)

- Secret 재발급 시 기존 암호화값을 `api_secret_prev`로 이동, 신규 암호화값을 `api_secret`에 저장
- `secret_rotated_at`에 재발급 시각 기록
- 유예기간(`API_SECRET_GRACE_PERIOD_DAYS`) 동안은 `api_secret`/`api_secret_prev` 둘 다 복호화해 서명 검증에 사용(2.4의 5번 — 어느 한쪽과만 일치해도 통과)
- 유예기간 경과 후 배치(`API_SECRET_CLEANUP_CRON`, 기본 `0 5 * * *`)가 `secret_rotated_at + API_SECRET_GRACE_PERIOD_DAYS`가 지난 `api_secret_prev`를 `NULL` 처리 — `SESSION_CLEANUP_CRON`과 동일하게 서버 기동 시 `node-cron`으로 등록
- Secret 발급(프로젝트 생성 시)/재발급 API 자체의 인증 주체는 관리 콘솔 사용자(SUPER_ADMIN/DEVELOPER)다 — [13_PROJECT_API.md](./13_PROJECT_API.md) 2.1/2.5 참고. 그 API들은 이 절의 S2S 인증과는 별개로 JWT 기반 사용자 인증(1장)을 그대로 따른다

## 2.7 API 버전 관리

S2S API(게임서버가 호출하는 쿠폰 발급/사용 관련 엔드포인트)는 버전 관리 대상이다. 게임서버(테넌트)마다 연동 시점이 달라, 쿠폰 서버의 배포 주기가 특정 게임서버의 대응 여부에 묶이면 안 되기 때문이다.

```text
대상    : S2S API만 해당 (관리 콘솔 API는 버전 없음 — 프론트/백을 같은 팀이 동시 배포하므로 불필요)
방식    : NestJS 내장 URI Versioning (app.enableVersioning({ type: VersioningType.URI }))
URL 패턴 : /v1/coupons/reserve, /v1/coupons/confirm 등
운영 규칙 : v1으로 시작, breaking change 발생 시 v2 컨트롤러를 추가하고 기존 v1 라우트는 유지
```

## 2.8 요청 제한(Rate Limit) 정책

`POST /v1/coupons/{code}/reserve`/`confirm`에 두 레이어를 겹쳐 적용한다 — **프로젝트(API Key) 단위**(인프라 보호)와 **유저(game_user_id) 단위**(공유 버킷 소진 방지, Redis 도입 3단계로 추가). 두 레이어는 목적과 알고리즘이 다르므로 아래에서 각각 서술한다.

### 2.8.1 프로젝트 단위 — 토큰 버킷

목적은 오남용 방지가 아니라 **인프라 보호**(특정 게임서버의 비정상 트래픽 폭주로부터 서버 전체를 지키는 것)다.

알고리즘은 고정 윈도우(1.4 로그인 리미터와 동일한 `express-rate-limit`)로 시작했다가 **토큰 버킷**으로 교체했다(2026-07-24) — 고정 윈도우는 윈도우 경계에서 이전 윈도우의 마지막 순간과 다음 윈도우의 첫 순간에 각각 최대치를 허용해, 아주 짧은 시간 안에 설정값의 거의 2배(예: 600회/분 설정에서 window 경계 전후로 순간 1200회에 가깝게)가 몰릴 수 있는 구조적 약점이 있다. 토큰 버킷은 버킷 용량(capacity)이 항상 그 시점의 절대 상한이라 이 문제가 없고, 대신 정상상태에서는 초당 일정하게 채워지는 토큰(refill)만큼만 지속 처리율을 허용해 순간 버스트와 평균 처리율을 분리해서 제어할 수 있다.

```text
기준   : X-API-Key 헤더값당 토큰 버킷 — 용량(capacity) 개까지 순간 버스트 허용, 이후 초당 refill개씩 회복
         (기본 용량 600 / 초당 10, COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY/COUPON_USAGE_RATE_LIMIT_REFILL_PER_SEC)
대상   : POST /v1/coupons/{code}/reserve, POST /v1/coupons/{code}/confirm (POST /v1/coupons/unconfirmed 제외 — HTTP 메서드와 무관하게 조회 전용 API라 상대적으로 저위험)
초과 시 : 429 Too Many Requests (Retry-After 헤더에 최소 대기 초 포함)
저장소 : in-memory (프로젝트 API Key별 버킷을 Map에 보관, 로그인 리미터와 동일하게 스케일아웃 시 인스턴스별로 버킷이 나뉘어 실효 한도가 인스턴스 수배로 늘어나는 한계는 인지하고 감수)
```

`X-API-Key` 헤더값을 그대로 버킷 키로 쓴다 — 미들웨어는 가드보다 먼저 실행되어 서명/nonce 검증 전이지만, 프로젝트별로 버킷을 나누는 목적에는 이 값으로 충분하다(1.4의 IP 기준 리미터가 IP 소유권을 검증하지 않는 것과 같은 성격). 헤더가 없으면 IP로 폴백해 리미터 자체가 죽지 않게만 한다.

### 2.8.2 유저 단위 — 슬라이딩 윈도우 카운터 (Redis 도입 3단계, 2026-08-05)

목적은 인프라 보호가 아니라, 특정 유저 한 명이 같은 프로젝트의 공유 토큰 버킷(2.8.1)을 과도하게 소진해 같은 프로젝트의 다른 유저까지 영향받는 상황을 막는 **2차 방어선**이다 — 실제 쿠폰 소비 한도는 `use_limit_per_user`가 SP 레벨에서 이미 원자적으로 강제하고, S2S 호출 주체(게임서버)가 유저별 호출 빈도를 1차로 조절할 수 있는 여지도 있어 필수 방어선은 아니다(`README.md` "향후 개선사항" 참고).

알고리즘은 고정 윈도우(2.8.1이 이미 겪은 경계 버스트 문제)/토큰 버킷(프로젝트 단위가 이미 사용 중이나 분산 환경에서 정확히 구현하려면 Lua 스크립트가 사실상 필수)/슬라이딩 윈도우 로그(가장 정확하지만 유저 수만큼 커지는 카운터엔 메모리·커맨드 비용 과다) 대신 **슬라이딩 윈도우 카운터**를 채택했다 — 이전+현재 윈도우 카운트를 가중평균으로 근사해 고정윈도우의 경계 버스트 문제를 대부분 해소하면서도, Redis 커맨드는 `INCR`+`GET`만으로 구현 가능해(Lua 불필요) 이 기능의 방어선 성격(2차, 필수 아님)에 맞는 구현 복잡도를 유지한다.

```text
기준   : (X-API-Key 헤더값 또는 IP):game_user_id 조합당 슬라이딩 윈도우 카운터
         weighted = curWindowCount + prevWindowCount * (1 - elapsedFraction)
         (기본 윈도우 60초 / 윈도우당 30회, COUPON_USAGE_USER_RATE_LIMIT_WINDOW_SEC/COUPON_USAGE_USER_RATE_LIMIT_MAX)
대상   : POST /v1/coupons/{code}/reserve, POST /v1/coupons/{code}/confirm (프로젝트 단위와 동일 — reserve/confirm 합산 카운트)
초과 시 : 429 Too Many Requests (Retry-After 헤더에 현재 윈도우 잔여 초 포함, 근사값)
저장소 : Redis (`SlidingWindowCounterLimiter`, `RedisService.get`/`incrWithExpire` 프리미티브만 사용)
```

**`REDIS_ENABLED=false`면 이 레이어는 완전히 스킵된다(폴백 없음)** — 2.5(nonce)는 DB에 이미 있던 경로로 fail-open 폴백하지만, 이 기능은 애초에 Redis 없이 구현한 적이 없는 신규 기능이라 대체할 in-memory 경로 자체가 없다. 이 경우에도 프로젝트 단위 리미터(2.8.1)는 계속 동작해 인프라 보호는 유지된다. Redis가 켜져 있는데 커맨드 자체가 실패하면(연결 끊김 등) 2.5(nonce)와 동일한 **fail-open**(가용성 우선) 철학으로 허용 처리한다 — 다만 2.5는 실패 시 DB 경로로 대체 검증하는 반면, 이 기능은 대체 경로 자체가 없어 곧바로 통과시킨다는 점이 다르다.

`game_user_id`가 요청 바디에 없으면(형식오류 등) 이 레이어를 건너뛴다 — 서비스 레이어가 곧 `30001`로 거부하므로 이중 처리가 불필요하다. 카운트는 거부된 시도도 포함해 항상 먼저 증가시킨다(공격자가 한도 바로 아래에서 무한정 버티는 것을 막기 위한 표준 구현 관례).

**미구현(TODO)**: 카운터 초과 시 운영 로그(예: `logs/s2s-failure.log`류 전용 파일) 관측 기능, 회사(company) 단위 리미터(미들웨어 시점엔 `company_id`를 알 수 없어 `S2sAuthGuard` 인증 이후로 걸어야 하는 등 별도 설계가 필요해 이연) — `README.md` "향후 개선사항" 참고.

---

# 3. 비밀번호 정책

- `user.password_hash`: bcrypt(rounds=12)

---

# 4. 관련 문서

- 테이블 구조: [06_DATABASE_SCHEMA.md](./06_DATABASE_SCHEMA.md)
