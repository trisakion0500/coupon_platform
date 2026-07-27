# test_game_server

coupon_platform의 S2S(게임서버 → 쿠폰서버) 쿠폰 사용 API를 실제 트래픽으로 검증하기 위한 독립
테스트 클라이언트다. `backend`/`frontend`와 완전히 분리된 별도 Node.js 프로젝트이며, 상시
실행되는 데몬으로 활성 캠페인·쿠폰코드를 스스로 찾아 reserve/confirm을 무작위로 계속 시도한다.

전체 설계(아키텍처, 시나리오, SP 목록, 캐비어트)는 [`docs/21_TEST_GAME_SERVER.md`](../docs/21_TEST_GAME_SERVER.md)를 참고한다. 이 파일은 실행법만 다룬다.

## 이 프로젝트가 하는 일

1. 쿠폰 DB에서 `CALL SPTG_*(...)`(이 프로젝트 전용 저장 프로시저, `database/procedures/`)로 활성
   캠페인/사용가능 코드/소진된 코드를 조회한다.
2. `project.api_secret`(암호문)을 로컬 `ENCRYPTION_KEY`로 복호화한다.
3. `src/sdk/CouponS2sClient.ts`(입점사에 그대로 제공 가능한 독립 SDK, 외부 의존성 0개)로 실제
   coupon_platform 백엔드의 reserve/confirm/미컨슘조회 API를 HTTP로 호출한다.
4. 정상 흐름/멱등 재시도/동시성 레이스/이미 소진된 쿠폰 재시도/보상지급 중단 재처리(리컨실리에이션)/
   에러 케이스 6개 시나리오를 무작위 가중치로 반복한다.

## 사전 준비

1. **coupon_platform 백엔드가 로컬에서 기동 중이어야 한다.**
2. **관리 콘솔로 최소 1개 이상의 캠페인을 활성화하고 코드를 발급해둬야 한다** — 이 도구는 캠페인을
   직접 만들지 않는다(설계 문서 1.2 참고).
3. **`database/procedures/` 아래 SPTG_ SP를 로컬 MySQL(coupon_platform DB)에 적용한다** —
   `all_procedures_testgame.sql`을 실행하거나 개별 파일을 순서 무관하게 실행한다. DB 작업은 항상
   사용자가 직접 수행한다.

## 실행

```bash
cd test_game_server
npm install
cp .env.example .env
```

`.env`를 열어 아래 값을 채운다:

- `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`: `backend/.env`와 동일한 로컬 개발 DB 접속 정보
- `ENCRYPTION_KEY`: `backend/.env`와 동일값(64자 hex)
- `COUPON_SERVER_BASE_URL`: 예) `http://localhost:3000`

나머지 항목(TICK_INTERVAL_MS, 시나리오 가중치 등)은 선택값이며 비워두면 문서 4장의 기본값을 쓴다.

```bash
npm run dev      # 데몬 시작, 파일 변경 시 자동 재시작
# 또는
npm run build && npm start   # 빌드 후 실행
```

`Ctrl+C`(SIGINT)로 정상 종료한다 — 진행 중인 tick만 마무리하고 DB 커넥션 풀/로거를 정리한다.

## 로그

- `logs/app.log` — 매 시나리오 실행 결과, 10 tick마다 누적 요약(콘솔에도 동시 출력)
- `logs/mismatch.log` — **이 도구의 핵심 산출물.** 기대와 다른 결과(멱등 재시도인데 usage_id가
  다름, 동시성 레이스 버스트 후 DB 행 수 불일치 등)만 모아 별도로 남긴다.

## 주의

- **로컬 개발 DB에서만 사용한다.** 운영 DB에 이 도구를 연결하지 않는다 — `ENCRYPTION_KEY`를
  갖고 DB에 직접 접근하는 것 자체가 실제 게임서버라면 있을 수 없는 동작이다(설계 문서 2.3 캐비어트).
- `.env`/`logs/`는 `.gitignore` 대상이다.
