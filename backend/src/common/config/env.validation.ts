import * as Joi from 'joi';

/**
 * 02_TECH_STACK.md 환경변수 관리 항목 전체를 기동 시점에 검증한다.
 * 아직 구현되지 않은 도메인(로그인 rate limit, 세션/secret 정리 크론 등)의 값도
 * 미리 검증해두면 해당 슬라이스 구현 시 이 파일을 다시 건드릴 필요가 없다.
 *
 * @author trisakion
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(3306),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  // 인스턴스당 mysql2 pool 크기 — 하드코딩이었다가 스케일아웃 점검(2026-07-23)에서 env로 이전.
  // 총 DB 커넥션 = 레플리카 수 × (DB_CONNECTION_LIMIT + LOG_DB_CONNECTION_LIMIT)이므로,
  // 레플리카를 늘릴 때 MySQL max_connections 한도에 맞춰 이 값을 낮춰 조정할 수 있어야 한다.
  DB_CONNECTION_LIMIT: Joi.number().integer().min(1).default(10),

  // 로그 전용 DB(coupon_platform_log) — 메인 DB와 물리적으로 분리(04_DEV_CONVENTIONS.md 1장).
  // 접속 계정이 메인 DB와 같을 수도 다를 수도 있어 별도 변수로 관리한다.
  LOG_DB_HOST: Joi.string().default('localhost'),
  LOG_DB_PORT: Joi.number().port().default(3306),
  LOG_DB_USER: Joi.string().required(),
  LOG_DB_PASSWORD: Joi.string().allow('').required(),
  LOG_DB_NAME: Joi.string().required(),
  LOG_DB_CONNECTION_LIMIT: Joi.number().integer().min(1).default(10),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // AES-256-CBC 키(user.phone_number/project.api_secret 공용) — 32바이트를 hex(64자)로 표현
  ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required()
    .messages({
      'string.pattern.base':
        'ENCRYPTION_KEY must be a 64-character hex string (32 bytes, for AES-256)',
    }),

  API_SECRET_GRACE_PERIOD_DAYS: Joi.number().integer().min(0).default(7),
  API_SECRET_CLEANUP_CRON: Joi.string().default('0 5 * * *'),

  S2S_TIMESTAMP_TOLERANCE_SEC: Joi.number().integer().min(1).default(300),
  S2S_NONCE_CLEANUP_CRON: Joi.string().default('*/10 * * * *'),

  CORS_ALLOWED_ORIGINS: Joi.string().allow('').default(''),

  LOG_DEBUG_ERRORS: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.boolean().default(false),

  API_EXECUTION_TIMEOUT_MS: Joi.number().integer().min(1).default(30000),

  LOGIN_RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1).default(900000),
  LOGIN_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),
  SESSION_CLEANUP_CRON: Joi.string().default('0 4 * * *'),

  // reserve/confirm 프로젝트(API Key) 기준 rate limit — 09_AUTH_SECURITY.md 2.8
  // 토큰 버킷 알고리즘(2026-07-24, 고정 윈도우에서 교체) — capacity는 순간 최대 버스트,
  // refill_per_sec는 정상상태 평균 처리율(초당)
  COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY: Joi.number()
    .integer()
    .min(1)
    .default(600),
  COUPON_USAGE_RATE_LIMIT_REFILL_PER_SEC: Joi.number()
    .integer()
    .min(1)
    .default(10),

  // reserve/confirm 유저(game_user_id) 기준 rate limit — 09_AUTH_SECURITY.md 2.8, Redis
  // 도입 3단계(2026-08-05). 프로젝트 단위 리미터와 별개 레이어, 슬라이딩 윈도우 카운터
  // 알고리즘. REDIS_ENABLED=false면 이 레이어는 완전히 스킵된다(폴백 없음).
  COUPON_USAGE_USER_RATE_LIMIT_WINDOW_SEC: Joi.number()
    .integer()
    .min(1)
    .default(60),
  COUPON_USAGE_USER_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(30),

  // RANDOM 코드 대량생성 백그라운드 루프(07_COUPON_ISSUANCE_SCENARIO.md 2.2) — DB 일시 오류
  // 재시도 한도/지연. 코드값 충돌(1062)은 이 설정과 무관하게 무제한 즉시 재시도한다.
  CODE_GENERATION_MAX_DB_RETRIES: Joi.number().integer().min(0).default(5),
  CODE_GENERATION_RETRY_BASE_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .default(200),

  // POST /campaigns/{id}/codes/abort(07_COUPON_ISSUANCE_SCENARIO.md 2.4) — "얼마나 오래
  // updated_at이 안 움직였으면 멈춘 것으로 볼지"를 위 두 값에서 계산하는 안전 배율. 별도
  // 독립적인 임계값을 두지 않고 재시도 설정에서 파생시켜, 두 설정이 서로 어긋나지 않게 한다.
  CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER: Joi.number()
    .integer()
    .min(1)
    .default(3),

  // 정체된 코드생성 job 감지 전용 모니터링 크론(스케일아웃 점검 5번, 2026-07-23) — 위 3개
  // 설정에서 계산한 동일한 "정체 판정" 임계값으로 SP_CAMPAIGN_CODE_GENERATION_STALE_LIST를
  // 주기 조회해 서버 로그로 경고만 남긴다(자동 복구는 하지 않음).
  CODE_GENERATION_STALE_MONITOR_CRON: Joi.string().default('*/5 * * * *'),

  // 사용기간이 지난 활성 캠페인 자동 종료 배치(SP_CAMPAIGN_EXPIRE, 2026-07-25) 스케줄.
  // 초 단위로 급박한 처리가 아니라 5분 기본값이면 충분하다고 판단.
  CAMPAIGN_EXPIRY_CRON: Joi.string().default('*/5 * * * *'),

  // Redis 도입 1단계(2026-08-05) — REDIS_ENABLED=true일 때만 REDIS_HOST/REDIS_KEY_PREFIX가
  // 필수가 된다. S2S nonce 재전송 방지(RedisService.setNx)의 1차 경로로 쓰이고, 실패 시 기존
  // DB 경로(SP_NONCE_INSERT)로 자동 폴백(fail-open)한다.
  REDIS_ENABLED: Joi.boolean().default(false),
  REDIS_HOST: Joi.string().when('REDIS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  REDIS_PORT: Joi.number().port().default(6379),
  // 비밀번호 없는 Redis 인스턴스도 있어 REDIS_ENABLED=true여도 필수로 두지 않는다.
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_KEY_PREFIX: Joi.string().when('REDIS_ENABLED', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Redis 도입 2단계(2026-08-05) — JwtAuthGuard.validateSession(jti->세션 검증) 읽기 캐시.
  // DB가 여전히 source of truth, Redis는 순수 캐시(SessionCacheService). 카운터 TTL이 캐시
  // TTL보다 짧거나 같으면, 카운터가 캐시보다 먼저 만료돼 0으로 리셋된 뒤 아직 살아있는 옛
  // 캐시 항목의 generation과 우연히 일치해버려 무효화(로그아웃/비번변경/계정정지)가 원상복구
  // 되는 보안 구멍이 생긴다 — 이 관계(카운터 TTL > 캐시 TTL)를 어긴 설정은 부팅 자체를 막는다.
  SESSION_CACHE_TTL_SEC: Joi.number().integer().min(1).default(60),
  SESSION_CACHE_GENERATION_TTL_SEC: Joi.number()
    .integer()
    .min(1)
    .default(120)
    .greater(Joi.ref('SESSION_CACHE_TTL_SEC'))
    .messages({
      'number.greater':
        'SESSION_CACHE_GENERATION_TTL_SEC must be greater than SESSION_CACHE_TTL_SEC (counter TTL must outlive the cache TTL it invalidates)',
    }),

  // log_coupon_rate_limit 적재용 api_key -> {project_id, company_id} 캐시(ProjectIdentityCacheService,
  // 2026-08-05) TTL. project.api_key/company_id는 생성 이후 절대 안 바뀌는 값이라(재발급/이관
  // 기능 없음) 만료 자체가 정합성 문제는 아니고, 그저 만료되면 다음 조회 때 SP 폴백으로 한 번 더
  // 채워지는 것뿐이라 길게 잡는다(기본 30일). REDIS_ENABLED=false면 이 캐시 자체를 안 쓰고
  // 매번 SP_PROJECT_GET_IDENTITY_BY_API_KEY로 조회한다(429는 원래 드문 이벤트라 무해).
  PROJECT_API_KEY_CACHE_TTL_SEC: Joi.number().integer().min(1).default(2592000),
});
