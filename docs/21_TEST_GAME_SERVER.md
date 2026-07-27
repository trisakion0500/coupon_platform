# 21_TEST_GAME_SERVER.md

# 테스트게임서버 설계

---

# 1. 개요

## 1.1 목적

`coupon_platform` 백엔드/프론트엔드 구현이 전부 끝난 뒤, 실제 게임서버가 S2S(API Key + HMAC-SHA256)로
쿠폰 사용(reserve/confirm) API를 호출하는 상황을 재현해 **살아있는 트래픽으로** 동시성/멱등성/재시도
방어가 실제로 동작하는지 검증하기 위한 독립 테스트 클라이언트다. 지금까지의 검증은 전부 사람이 만든
시나리오(E2E 스펙, 수동 스모크 스크립트)였는데, 이 도구는 **활성 캠페인·쿠폰코드를 스스로 찾아 무작위로
계속 사용을 시도하는 상시 실행 데몬**이라는 점이 다르다 — 미리 정해둔 입력이 아니라 그 순간 DB에 실제로
존재하는 데이터를 기준으로 시나리오를 구성하므로, 사람이 놓칠 수 있는 조합(예: 마침 소진 직전인 캠페인에
동시 요청이 몰리는 경우)이 자연스럽게 섞여 들어간다.

## 1.2 범위

- **다룬다**: `coupon_code`/`coupon_campaign`/`project` 테이블 읽기 전용 조회로 사용 대상을 스스로
  선정 → 실제 S2S API(`POST /v1/coupons/{code}/reserve`, `POST /v1/coupons/{code}/confirm`)를
  HTTP로 호출 → 정상 흐름(90% confirm, 나머지 10%는 보상지급 중단 시뮬레이션)/멱등 재시도/동시성
  레이스/이미 소진된 쿠폰 재시도/보상지급 중단 재처리(리컨실리에이션)/에러 케이스를 반복 재현.
- **다루지 않는다**: 캠페인 생성·코드 발급·승인 같은 관리 콘솔 측 준비 작업(사용자가 관리 콘솔에서
  미리 캠페인을 활성화하고 코드를 발급해둬야 이 도구가 대상을 찾을 수 있다). 쿠폰서버 소스 수정도
  다루지 않는다 — 순수 외부 클라이언트다.
- **위치**: `coupon_platform` 리포 최상위 `test_game_server/` 폴더. `backend`/`frontend`와 완전히
  독립된 별도 Node.js 프로젝트(자체 `package.json`)로 둔다 — 실제 외부 게임서버가 이 리포의 소스를
  가져다 쓸 수 없는 것과 동일한 조건을 재현하기 위해 `backend`의 `CryptoService`/`S2sAuthGuard` 로직을
  import하지 않고 필요한 만큼만 자체 구현한다.

---

# 2. 아키텍처

## 2.1 실행 모델 — 상시 실행 데몬

1회성 배치가 아니라 **계속 실행되며 주기적으로(tick) 무작위 시도를 만들어내는 프로세스**다.
`SIGINT`/`SIGTERM` 수신 시 진행 중인 tick만 마무리하고 타이머 해제 + DB 커넥션 풀 종료 후 정상
종료한다(coupon_platform 백엔드의 그레이스풀 셧다운 원칙과 동일한 감각).

## 2.2 데이터 흐름

```
[test_game_server]
  1. coupon DB ── CALL SPTG_*(...) 로만 조회 (project / coupon_campaign / coupon_code / coupon_code_usage)
  2. project.api_secret(SP가 암호문 그대로 반환) → AES-256-CBC 복호화 (ENCRYPTION_KEY, SP 밖에서 수행)
  3. HMAC-SHA256 서명 생성 (S2sAuthGuard.buildStringToSign과 동일 규칙, 자체 구현)
  4. HTTP ── POST /v1/coupons/{code}/reserve, /confirm  (coupon_platform 백엔드)
```

이 도구가 실제로 **쓰기 작업을 하는 경로는 4번(HTTP API 호출)뿐**이다 — DB 쪽은 조회(`CALL SPTG_*`)만
하고 INSERT/UPDATE는 전혀 하지 않는다. 쿠폰 소모/확정은 반드시 쿠폰서버의 SP를 경유하는 실제 API로만
일어나야 검증 대상(동시성 방어)이 의미가 있기 때문이다.

**DB 콜은 이 프로젝트도 예외 없이 SP로만 한다** — coupon_platform 전체 원칙(ORM/Native SQL 직접 작성
금지, `CLAUDE.md` 아키텍처 절)을 이 테스트 도구에도 그대로 적용한다. `testing/db/queries.ts`는 raw
`SELECT`를 직접 조립하지 않고 전부 `CALL SPTG_*(...)`만 호출한다(10장). 이렇게 하는 이유는 단순히
일관성 때문만이 아니라, 이 프로젝트가 지향하는 운영 DB 계정 모델(`04_DEV_CONVENTIONS.md` 4.1 — 운영
계정은 EXECUTE 권한만 부여)과도 맞물린다 — "외부에서 DB를 직접 조회하는" 이 도구조차 raw SELECT
권한 없이 동작 가능해야, 실제로 그런 제한된 계정을 발급해도 이 도구가 계속 쓸 수 있다.

## 2.3 중요한 캐비어트 — 실제 운영 게임서버와는 보안모델이 다르다

이 도구는 **쿠폰 DB에 직접 접근해 `project.api_secret`(암호문)을 읽고 `ENCRYPTION_KEY`로 복호화**한다.
실제 운영 환경의 게임서버는 절대 이렇게 동작하지 않는다 — API Secret은 발급/재발급 시점에 평문으로
1회만 노출되고, 그 이후로는 게임서버 자신이 별도 보관하는 것이 정상적인 모델이다(`docs/09_AUTH_SECURITY.md`).
`ENCRYPTION_KEY`를 외부 게임서버가 갖고 있다는 전제 자체가 이미 보안모델을 벗어난다.

이 방식을 택한 이유는 순수하게 **테스트 편의성** 때문이다 — 캠페인/코드를 관리 콘솔 API로 매번
조회하려면 관리자 계정 로그인·JWT 관리까지 별도로 구현해야 하는데, 이 도구의 목적은 관리 콘솔 인증
흐름이 아니라 쿠폰 사용(S2S) 경로의 동시성/멱등성 검증이다(2026-07-26 사용자 결정, `CLAUDE.md` "다음
업무" 절 참고). 따라서:

- **로컬 개발 DB에서만 사용한다.** 운영 DB `.env`를 이 도구에 연결하지 않는다.
- `test_game_server/.env`(gitignore 대상)에만 `ENCRYPTION_KEY`/DB 자격증명을 두고 절대 커밋하지 않는다.
- 이 폴더는 배포 대상이 아니다 — CI/CD, Docker 이미지 등 어디에도 포함시키지 않는다.

---

# 3. 폴더 구조

```
test_game_server/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore              # .env, dist/, node_modules/
├── README.md               # 실행법
├── database/
│   └── procedures/          # SPTG_* 저장 프로시저 개별 파일 + all_procedures_testgame.sql (10장)
└── src/
    ├── index.ts             # 엔트리 — 데몬 부트스트랩, SIGINT/SIGTERM 핸들링
    ├── config.ts            # .env 로딩 + 검증
    ├── logger.ts             # log4js 설정 (backend log4js-logger.service.ts와 동일한 감각, 독립 구성 — 7장)
    ├── sdk/
    │   └── CouponS2sClient.ts   # ★ 입점사에 그대로 제공 가능한 단독 S2S 연동 모듈 — 9장 참고
    ├── testing/                 # 테스트게임서버 전용(입점사에는 제공하지 않는 부분)
    │   ├── db/
    │   │   ├── pool.ts           # mysql2 커넥션 풀 (CALL SPTG_* 전용, raw SELECT 없음)
    │   │   └── queries.ts        # getActiveCampaigns / getUsableCodes / getExhaustedTargets 등 — 전부 CALL SPTG_*(...) 래핑
    │   └── decryptProjectSecret.ts  # SP가 반환한 암호문 api_secret을 SDK 입력용 평문으로 복호화 (테스트 편의, 9.2 캐비어트)
    ├── scenarios/
    │   ├── types.ts           # 시나리오 공통 타입(ScenarioResult 등)
    │   ├── normalFlow.ts       # 정상 reserve + confirm 비율 적용 (CouponS2sClient 사용)
    │   ├── idempotentRetry.ts  # 동일 코드+유저 재시도 → 동일 usage 응답 검증
    │   ├── concurrencyRace.ts  # Promise.all 동시 reserve 버스트
    │   ├── exhaustedRetry.ts   # 이미 소진된 코드 재시도 → 에러코드 검증
    │   └── errorCases.ts       # 존재하지 않는 코드 / reserve 없이 confirm
    ├── scheduler.ts           # tick 루프 + 시나리오 가중치 선택
    └── stats.ts               # 시나리오/결과코드별 카운터 집계·주기 출력
```

`src/sdk/CouponS2sClient.ts` 한 파일만 별도 경계를 둔 이유는 9장 참고 — 나머지(`testing/`)는 "테스트게임서버가
대상을 스스로 찾기 위한" 이 프로젝트 전용 편의 코드이고, `sdk/`만 실제 입점사에 넘겨도 되는 산출물이다.

---

# 4. 환경변수 (`test_game_server/.env`)

| 변수                      | 필수 | 기본값    | 설명                                                                 |
| ------------------------- | ---- | --------- | ---------------------------------------------------------------------- |
| `DB_HOST`                 | Y    | -         | 로컬 개발 DB(coupon_platform, 메인) 접속 정보 — `backend/.env`와 동일값 |
| `DB_PORT`                 | Y    | -         |                                                                          |
| `DB_USER`                 | Y    | -         |                                                                          |
| `DB_PASSWORD`              | Y    | -         |                                                                          |
| `DB_NAME`                 | Y    | -         | `coupon_platform`                                                       |
| `ENCRYPTION_KEY`           | Y    | -         | `backend/.env`와 동일값(64자 hex) — `project.api_secret` 복호화용        |
| `COUPON_SERVER_BASE_URL`   | Y    | -         | 예: `http://localhost:3000`                                            |
| `TICK_INTERVAL_MS`         | N    | `5000`    | 시도 사이 간격                                                          |
| `GAME_USER_POOL_SIZE`      | N    | `50`      | 시뮬레이션에 쓸 `game_user_id` 풀 크기(재사용해야 한도초과/멱등 케이스가 자연히 발생)|
| `CONFIRM_RATIO`             | N    | `0.9`     | reserve 성공 후 confirm까지 진행할 확률(90%) — 나머지는 미컨슘 상태로 남김 |
| `RACE_BURST_COUNT`          | N    | `5`       | 동시성 레이스 시나리오에서 한 번에 쏘는 동시 요청 수                      |
| `RECONCILE_RETRY_RATIO`      | N    | `0.5`     | 리컨실리에이션(6.6)에서 미컨슘 건 중 이번 tick에 confirm 재시도할 비율    |
| `SCENARIO_WEIGHT_NORMAL`    | N    | `60`      | 정상 흐름 가중치(%)                                                     |
| `SCENARIO_WEIGHT_IDEMPOTENT`| N    | `10`      | 멱등 재시도 가중치(%)                                                   |
| `SCENARIO_WEIGHT_RACE`      | N    | `10`      | 동시성 레이스 가중치(%)                                                 |
| `SCENARIO_WEIGHT_EXHAUSTED` | N    | `5`       | 이미 소진된 코드 재시도 가중치(%)                                       |
| `SCENARIO_WEIGHT_RECONCILE` | N    | `10`      | 보상지급 중단 재처리(리컨실리에이션) 가중치(%)                           |
| `SCENARIO_WEIGHT_ERROR`     | N    | `5`       | 에러 케이스 가중치(%)                                                   |

가중치 6개 합은 100이어야 하며, `config.ts`가 부팅 시 검증한다(불일치 시 즉시 종료 — 조용히 정규화하지 않는다).

---

# 5. 핵심 흐름 (매 tick)

1. **활성 캠페인 조회** — `CALL SPTG_ACTIVE_CAMPAIGN_LIST()` (10.1, `status=2 AND approval_status IN (1,3) AND
   NOW() BETWEEN campaign_start AND campaign_end AND project.status=1`인 캠페인을 project의 `api_key`/
   `api_secret`/`api_secret_prev`와 함께 반환). 결과가 비어 있으면 이번 tick은 경고 로그만 남기고
   건너뛴다(관리 콘솔에서 활성 캠페인을 준비해야 동작 — 1.2 범위 참고).

2. **캠페인 무작위 선택** 후 해당 `project_id`의 `api_secret`을 복호화한다.

3. **시나리오 무작위 선택**(4장 가중치 기준)에 따라 6장의 시나리오 중 하나를 실행한다. 시나리오별로
   필요한 `coupon_code`/`coupon_code_usage` 조회 쿼리가 다르므로 6장 참고.

4. 결과를 `stats.ts`에 누적하고, `N`번째 tick마다(기본 10 tick) 요약을 로그로 출력한다.

---

# 6. 시나리오

## 6.1 정상 흐름 (기본 가중치 60%)

1. 선택된 캠페인의 `coupon_campaign_id`로 `CALL SPTG_USABLE_CODE_LIST(i_coupon_campaign_id)`(10.2)를
   호출해 사용 가능한(`status=1`) 코드 목록을 받고 그중 하나를 무작위로 고른다 — RANDOM은 여러 건 중
   하나, FIXED는 캠페인당 코드가 1건뿐이라 사실상 그 1건이 그대로 선택된다.
2. `game_user_id` 풀에서 무작위로 하나 선택.
3. `POST /v1/coupons/{code}/reserve` 호출.
4. 성공(200)이면 `CONFIRM_RATIO` 확률(기본 90%)로 그 자리에서 바로 `POST /v1/coupons/{code}/confirm`을
   호출해 "지급까지 정상 완료"를 시뮬레이션한다. 나머지 확률(기본 10%)은 **의도적으로 confirm을
   호출하지 않고 이번 tick을 끝낸다** — 게임서버가 reserve로 쿠폰을 소모 확정한 직후, 실제 보상
   지급 처리 도중 크래시/타임아웃/네트워크 단절로 confirm 콜백을 못 보내는 상황을 그대로 재현한 것이다
   (`coupon_code_usage.confirmed_at IS NULL`로 남는 이 상태가 6.6 리컨실리에이션 시나리오의 대상이 된다).
5. 성공한 reserve는 `idempotentRetry`/`exhaustedRetry` 시나리오가 나중에 재사용할 수 있도록
   in-memory 이력(`{projectId, codeValue, gameUserId, useLimitPerUser}`)에 기록한다.

## 6.2 멱등 재시도 (기본 가중치 10%)

6.1이 기록해둔 이력 중 `use_limit_per_user=1`인 성공 건을 무작위로 골라 **동일한 코드+동일한
`game_user_id`로 reserve를 다시 호출**한다. `20_COUPON_USAGE_API.md` 2.1의 멱등 규칙에 따라
새 소모를 만들지 않고 최초 성공 응답과 동일한 `coupon_code_usage_id`가 돌아와야 한다 — 다르면
버그로 로그에 강조 출력한다. confirm도 동일한 방식으로 재호출해 멱등성을 확인한다.

## 6.3 동시성 레이스 (기본 가중치 10%, `RACE_BURST_COUNT`개 동시 요청)

아직 소모되지 않은 코드를 하나 골라 `Promise.all`로 동시에 여러 건의 reserve를 쏜다. 코드/캠페인
구성에 따라 기대 결과가 다르므로, 매번 아래 셋 중 하나를 무작위로 골라 수행한다:

| 변형                                              | 요청 구성                                   | 기대 결과                                                                 |
| -------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| RANDOM 코드 동시 소모 경쟁                          | 같은 RANDOM 코드 + 서로 다른 `game_user_id` N개 | 정확히 1건만 200, 나머지는 33001(이미 소모됨)                                |
| FIXED 코드(`use_limit_per_user=1`) 동일 유저 동시 재시도 | 같은 FIXED 코드 + 같은 `game_user_id` N개      | 전부 동일한 `coupon_code_usage_id`로 수렴(2026-07-22 수정된 INSERT→FOR UPDATE 재확인 순서가 실제로 데드락 없이 멱등 수렴하는지 검증) |
| FIXED 코드(`use_limit_per_user>1`) 동일 유저 동시 시도 | 같은 FIXED 코드 + 같은 `game_user_id` N개(N > 한도) | 정확히 `min(N, use_limit_per_user)`건만 200, 나머지는 33003(한도초과)         |

버스트 종료 후 `CALL SPTG_USAGE_COUNT(...)`(10.5)로 **실제 `coupon_code_usage` 행 수가 기대치와
일치하는지 DB에서 직접 재확인**한다(이 도구가 DB 읽기 권한을 가진 걸 활용하는 유일한 "사후 검증"
지점) — HTTP 응답 코드 분포만으로는 못 잡는 이중 확정 같은 문제를 여기서 잡아낸다.

## 6.4 이미 소진된 쿠폰 재시도 (기본 가중치 5%)

DB에서 이미 소모 완료된 대상을 스스로 찾아 재시도한다(6.1~6.3에서 이 프로세스가 직접 만든 이력에
의존하지 않고, 그 사이 다른 액터가 소모시킨 것까지 포함해 더 넓게 검증) — `CALL SPTG_EXHAUSTED_RANDOM_CODE()`
(10.3, 이미 `status=2`가 된 RANDOM 코드 무작위 1건)와 `CALL SPTG_EXHAUSTED_FIXED_TARGET()`(10.4,
`use_limit_per_user`에 도달한 `(campaign, game_user_id)` 조합 무작위 1건) 중 하나를 무작위로 호출한다.

reserve를 재호출해 RANDOM은 33001, FIXED 한도초과는 33003이 정확히 돌아오는지 확인한다.

## 6.5 에러 케이스 (기본 가중치 5%)

- 존재하지 않는 `code_value`(무작위 문자열)로 reserve → 31005
- reserve 이력이 없는 코드+`game_user_id` 조합으로 confirm → 31006
- `game_user_id` 누락 요청 → 30001

## 6.6 보상지급 중단 재처리 (리컨실리에이션, 기본 가중치 10%)

6.1의 10%가 만들어낸(confirm이 오지 않은) 미컨슘 건을 게임서버 스스로 나중에 발견해 재처리하는
흐름을 재현한다 — `08_COUPON_USAGE_SCENARIO.md` 3장이 정의한 "confirm이 안 와도 쿠폰서버는 되돌리지
않고, 재처리 여부/시점 판단은 전적으로 게임서버 책임"이라는 설계를 실제로 소비하는 유일한 시나리오다.

1. `CouponS2sClient.getUnconfirmed({ page: 1, pageSize: 20 })`(전체유저 모드, 9.3)를 호출해 이
   프로젝트의 미컨슘 목록을 가져온다(캠페인 필터 없이 프로젝트 전체 대상 — 게임서버가 자기 쪽
   재처리 배치를 도는 것과 동일한 그림).
2. 반환된 건 중 무작위로 일부를 골라 "이번에는 보상 지급이 성공했다"고 가정하고 `confirm`을
   재호출한다 — 나머지는 이번에도 일부러 건드리지 않고 다음 리컨실리에이션 tick으로 넘긴다
   (연속 실패/느린 재처리까지 재현). 재처리 대상 선택 비율은 `RECONCILE_RETRY_RATIO`(기본 0.5)로
   조절한다.
3. `stats.ts`가 미컨슘 잔존 건수(매 리컨실리에이션 tick에서 받은 `total_count`)를 별도로 추적해
   요약 로그에 함께 찍는다 — 정상 동작한다면 이 잔존 건수가 시간이 지나며 무한정 쌓이지 않고
   등락하는 것으로 "언젠가는 재처리된다"는 걸 눈으로 확인할 수 있다.

이 시나리오는 새로운 소모(reserve)를 만들지 않고 기존 미컨슘 건을 조회·재처리만 하므로, 6.3(동시성
레이스)과 달리 DB 사후 검증은 필요 없다(confirm은 상태를 바꾸지 않는 지급 결과 기록일 뿐이라
동시 확정 문제 자체가 없음 — `20_COUPON_USAGE_API.md` 2.2 Business Rules 참고).

## 6.7 레이트리밋(40001)은 mismatch로 취급하지 않는다

`TICK_INTERVAL_MS`를 공격적으로 낮추면(예: 50ms, 초당 20 tick) 프로젝트 단위 토큰버킷
(`COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY`/`REFILL_PER_SEC`, `09_AUTH_SECURITY.md` 2.8)이 실제로
고갈돼 `RATE_LIMIT_EXCEEDED`(40001)가 섞여 들어올 수 있다 — 이건 각 시나리오가 검증하려는
비즈니스 로직(SP 동시성/멱등성)과 무관한 외부 스로틀링이라, 그대로 두면 "기대와 다른 결과"로
오판해 `mismatch.log`를 가짜 양성으로 오염시킨다(2026-07-27, 실제로 재현되어 발견). 그래서
`scenarios/rateLimit.ts`의 `isRateLimited()`로 공용 판별해 이 코드를 만나면 mismatch 대신 정보
로그(`app.log`)만 남기고 건너뛴다 — 6.2(reserve/confirm 재시도 개별 판정), 6.4(RANDOM/FIXED 소진
재시도 개별 판정 — 실제로 최초 구현 때 이 시나리오만 빠뜨렸다가 5분 실행 테스트 중 mismatch로
재현되어 뒤늦게 추가됨, 2026-07-27), 6.5(개별 에러 케이스 판정), 6.3(버스트 중 단 1건이라도
40001이면 그 버스트 전체의 성공건수/DB 사후검증을 스킵 — 일부만 외부 스로틀링에 걸리면 나머지
응답 분포가 순수 동시성 결과를 더 이상 반영하지 않으므로) 넷 다 적용된다.

---

# 7. 통계/로깅

로깅은 `log4js`로 한다 — `backend/src/common/logging/log4js-logger.service.ts`와 동일한 감각(콘솔 +
날짜별 회전 파일, 카테고리로 관심사 분리)으로 `test_game_server/src/logger.ts`에 독립적으로 구성한다
(NestJS `LoggerService` 어댑터는 필요 없다 — 이 프로젝트는 NestJS가 아니므로 `log4js.getLogger()`를
직접 쓴다).

- **`app` 카테고리**(기본): 매 시나리오 실행 결과를 `{scenario, resultCode, httpStatus, elapsedMs}`
  형태로 1줄 로그. 콘솔 + `logs/app.log`(날짜별 회전, `app.log` → 자정에 `app.2026-07-27.log`처럼
  회전, backend와 동일한 `dateFile`+`keepFileExt` 패턴)에 남긴다.
- **`mismatch` 카테고리**(신설, `code-generation-stale` 카테고리와 동일한 선례): 기대와 다른 결과
  (예: 6.2 멱등 재시도인데 `usage_id`가 달라짐, 6.3 버스트 후 DB 행 수 불일치)는 `warn` 레벨로 이
  카테고리에 남겨 콘솔 + `logs/mismatch.log`로 분리한다 — 이 도구의 핵심 산출물은 바로 이 파일이다.
  일반 `app.log`에 묻히면 수백~수천 건의 정상 로그 사이에서 놓치기 쉽기 때문이다.
- `N` tick마다(기본 10) 시나리오별/결과코드별 누적 카운터 + 6.6의 미컨슘 잔존 건수를 `app` 카테고리로
  요약 출력.

---

# 8. 실행 방법

```bash
cd test_game_server
npm install
cp .env.example .env   # DB_*/ENCRYPTION_KEY는 backend/.env와 동일값, COUPON_SERVER_BASE_URL 설정
npm run dev             # 데몬 시작, Ctrl+C로 정상 종료
```

사전 조건: coupon_platform 백엔드가 로컬에서 기동 중이어야 하고, 관리 콘솔로 활성 상태(`status=2`)
캠페인과 발급된 코드가 최소 1건 이상 준비돼 있어야 한다(1.2 범위 참고). **DB 자격증명이 필요한
`.env` 설정과 실제 실행은 사용자가 직접 수행한다** — 이 리포의 다른 스모크 테스트 도구들과 동일한
원칙(`CLAUDE.md` "DB 관련 명령은 항상 사용자가 직접 수행").

---

# 9. S2S 연동 SDK (`CouponS2sClient`) — 입점사 제공용

## 9.1 목적

`src/sdk/CouponS2sClient.ts` 한 파일은 테스트게임서버 내부 전용 코드가 아니라 **실제 입점사(게임사)가
S2S 연동을 구현할 때 그대로 복사해가거나 참고할 수 있는 독립 산출물**이다. 나머지 코드(`testing/`,
`scenarios/`, `scheduler.ts`)는 "대상을 스스로 찾아 무작위로 두들겨보는" 이 프로젝트만의 테스트
편의 계층이라 입점사가 가져갈 이유가 없지만, 실제 서명 규칙(HMAC-SHA256, stringToSign 구성, 4개
헤더)과 reserve/confirm/unconfirmed 호출 방식은 모든 입점사가 동일하게 구현해야 하므로 이 부분만
분리해 재사용 가능한 형태로 만든다.

## 9.2 설계 원칙

- **외부 의존성 0개**: Node.js 22 LTS 내장 `crypto`(HMAC 서명)와 전역 `fetch`(HTTP 호출)만 사용한다.
  `axios` 등 패키지에 의존하면 입점사가 이 파일 하나만 복사해왔을 때 추가 설치가 필요해져
  "그대로 제공 가능"이라는 목적에 어긋난다.
- **입력은 항상 평문**: 생성자는 `{ baseUrl, apiKey, apiSecret }`만 받는다. `apiSecret`은 반드시
  평문(발급/재발급 API 응답으로 1회 노출된 값을 입점사가 자체 보관한 것)이어야 한다 — 이 SDK
  자체에는 복호화 로직이 없다. DB에서 읽은 암호문을 복호화하는 `testing/decryptProjectSecret.ts`는
  이 SDK와 완전히 분리된 별도 파일이며, 그 결과(평문)만 `CouponS2sClient` 생성자에 넘긴다. 이렇게
  나눠야 "이 SDK를 그대로 입점사에 준다"는 전제가 실제 배포 시에도 안전하다(복호화 로직·`ENCRYPTION_KEY`가
  섞여 들어가지 않음, 2.3의 캐비어트와 동일한 경계).
- **`09_AUTH_SECURITY.md` 2.3 규칙 그대로**: `stringToSign = [method, path, rawQuery, timestamp, nonce, bodyString].join('\n')`,
  `nonce`는 매 요청 새 UUID, `timestamp`는 Unix epoch seconds. 4개 헤더(`X-API-Key`/`X-API-Timestamp`/
  `X-API-Nonce`/`X-API-Signature`)를 자동으로 구성해 붙인다 — `backend/test/utils/s2s.ts`(E2E
  테스트 하네스)와 동일한 규칙을 쓰되, 그 파일을 import하지 않고 이 SDK 안에 자체 구현한다(테스트
  코드에 대한 의존을 배포 산출물에 남기지 않기 위함).
- **에러는 타입화해서 던진다**: HTTP 에러 응답(`{result, message}`)을 `CouponApiError`(필드:
  `resultCode`/`httpStatus`/`message`)로 감싸 던진다 — 입점사가 `err instanceof CouponApiError`로
  잡아 `resultCode`별 분기(33001/33002/33003 등, `20_COUPON_USAGE_API.md` 참고)를 하기 쉽게 한다.

## 9.3 공개 API (초안)

```ts
export interface CouponS2sClientOptions {
  baseUrl: string;   // 예: https://coupon-api.example.com
  apiKey: string;
  apiSecret: string; // 평문
}

export class CouponS2sClient {
  constructor(options: CouponS2sClientOptions);

  reserve(codeValue: string, gameUserId: string): Promise<ReserveResult>;
  confirm(codeValue: string, gameUserId: string): Promise<ConfirmResult>;

  // game_user_id 지정 시 특정유저 모드, 미지정 시 page/pageSize 필수(전체유저 모드) — 20_COUPON_USAGE_API.md 3장
  getUnconfirmed(params: { gameUserId?: string; campaignId?: number; page?: number; pageSize?: number }): Promise<UnconfirmedResult>;
}

export class CouponApiError extends Error {
  readonly resultCode: number;
  readonly httpStatus: number;
}
```

## 9.4 테스트게임서버 내부에서의 사용

`scenarios/` 아래 모든 시나리오는 이 `CouponS2sClient` 인스턴스만 주입받아 사용한다(`testing/db`,
`testing/decryptProjectSecret`로 얻은 `{apiKey, apiSecretPlain, baseUrl}`로 매 tick 캠페인이 바뀔 때마다
새 인스턴스를 만들거나, 프로젝트별로 캐싱한다). 즉 이 프로젝트 자신도 "SDK를 쓰는 입점사 1곳"처럼
`CouponS2sClient`를 소비하는 구조로 만들어, 실제 입점사 사용 경험과 동일한 경로를 스스로도 검증한다.

---

# 10. 테스트 전용 지원 SP (`SPTG_` 접두어)

## 10.1 배치 위치와 네이밍

이 도구가 필요한 DB 조회는 전부 신규 저장 프로시저로 만든다(2.2 "DB 콜은 SP로만" 원칙). 다만 이
SP들은 coupon_platform이라는 **제품 자체의 API 표면이 아니라 이 테스트 도구 전용**이므로, 제품 SP
카탈로그인 `coupon_platform/database/procedures/`(`all_procedures.sql`)에 섞어 넣지 않고 `test_game_server`
리포 자신의 `test_game_server/database/procedures/`(+ `all_procedures_testgame.sql`)에 둔다 — 1.2에서
`test_game_server`를 `backend`/`frontend`와 완전히 독립된 별도 프로젝트로 두기로 한 것과 같은 감각으로,
DDL/DML 산출물도 그 프로젝트에 딸린 것은 그 프로젝트 폴더 안에 함께 둔다. 실행 대상 DB는 여전히 같은
물리 DB(`coupon_platform`)이지만(2.3의 "로컬 개발 DB에서만 사용" 캐비어트 그대로 적용), **SQL 파일이
어느 리포에 속하는지**는 제품 SP 카탈로그와 명확히 분리해 "제품이 실제로 쓰는 SP"와 "테스트 도구가
자기 편의로 쓰는 SP"가 섞이지 않게 한다. 적용(로컬 MySQL에 `CREATE PROCEDURE` 실행)은 다른 모든 SP와
동일하게 사용자가 직접 수행한다(`CLAUDE.md` "DB 관련 명령은 항상 사용자가 직접 수행").

네이밍은 기존 `SP_도메인_동작` 규칙과 구분되도록 **`SPTG_동작`**(전부 대문자, `SP_`가 아니라 `SPTG_`)
접두어를 쓴다 — 이름만 보고도 "이건 제품 SP가 아니라 테스트게임서버 전용"이라는 걸 즉시 알 수 있게
하기 위함이다. 일반 SP처럼 RESULT 단일 컬럼 규약(`04_DEV_CONVENTIONS.md` 3.4)은 따르지 않는다 —
이 SP들은 `SpExecutorService`를 거치지 않고 `test_game_server`가 mysql2로 직접 `CALL`해 첫 번째
결과셋을 그대로 읽으며, 실패할 만한 비즈니스 조건이 없는 순수 조회이기 때문이다(정상적으로는
빈 결과셋이 곧 "이번엔 대상 없음"을 의미할 뿐 에러가 아니다).

## 10.2 SP 목록

| SP                              | 파라미터                                                        | 설명                                                                                     |
| -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `SPTG_ACTIVE_CAMPAIGN_LIST`       | -                                                                    | `status=2 AND approval_status IN(1,3) AND NOW() BETWEEN campaign_start AND campaign_end AND project.status=1`인 캠페인 전체 + `project.api_key`/`api_secret`/`api_secret_prev` (5.1) |
| `SPTG_USABLE_CODE_LIST`           | `i_coupon_campaign_id`                                              | 해당 캠페인의 `status=1`(사용가능) `coupon_code` 목록, `ORDER BY RAND() LIMIT 100`으로 상한 (6.1) |
| `SPTG_EXHAUSTED_RANDOM_CODE`      | -                                                                    | `status=2`(사용완료)인 RANDOM 코드 + 소속 프로젝트 자격증명 무작위 1건 (6.4)                 |
| `SPTG_EXHAUSTED_FIXED_TARGET`     | -                                                                    | `use_limit_per_user > 1`이고 그 한도에 도달한 `(coupon_campaign_id, game_user_id)` 조합 + 소속 프로젝트 자격증명 무작위 1건 (6.4) |
| `SPTG_USAGE_COUNT`                | `i_project_id`, `i_code_value`, `i_game_user_id`(NULL 허용)          | `coupon_code_usage` 실제 행 수 — `i_game_user_id`가 NULL이면 코드 전체, 아니면 해당 유저로 한정 (6.3 사후 검증) |

`SPTG_USABLE_CODE_LIST`에 `LIMIT 100`을 둔 이유는 RANDOM 캠페인이 대량 발급(예: 10,000건)됐을 때
결과셋 전체를 애플리케이션으로 끌고 올 필요가 없기 때문이다 — 어차피 그중 1건만 무작위로 쓰므로
`ORDER BY RAND() LIMIT 100` 후 애플리케이션에서 다시 1건을 뽑는 2단계 무작위로도 충분히 고르게
분포한다.

`SPTG_EXHAUSTED_FIXED_TARGET`이 `use_limit_per_user > 1`인 조합만 대상으로 하는 이유는, `=1`인 경우는
`20_COUPON_USAGE_API.md` 2.1의 멱등 규칙(같은 코드+같은 `game_user_id` 재시도 시 에러가 아니라 최초
성공 응답을 그대로 재반환)이 적용돼 재시도해도 33003이 아니라 200이 돌아오기 때문이다 — 그 케이스는
6.4가 아니라 6.2(멱등 재시도)의 영역이라 처음부터 후보에서 제외한다.

`SPTG_EXHAUSTED_RANDOM_CODE`/`SPTG_EXHAUSTED_FIXED_TARGET`은 **현재 선택된 캠페인(5.1)과 무관하게
DB 전체에서 대상을 찾는다** — 6.4 시나리오가 6.1~6.3이 그 tick에 우연히 고른 캠페인이 아니라, 그
사이 다른 액터가 소모시킨 것까지 더 넓게 검증하려는 의도이기 때문이다. 그래서 두 SP 모두 `SPTG_ACTIVE_CAMPAIGN_LIST`와
동일하게 `project.api_key`/`api_secret`/`api_secret_prev`를 함께 반환한다 — 6.4는 `SPTG_ACTIVE_CAMPAIGN_LIST`가
이번 tick에 반환한 목록과 무관한 프로젝트를 대상으로 할 수 있으므로, 그 목록에서 우연히 project_id가
일치하는 항목을 끼워맞추는 방식은 신뢰할 수 없다(대상 프로젝트가 이번 tick에 활성 캠페인이 하나도
없을 수도 있다).
