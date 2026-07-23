import * as Joi from 'joi';

/**
 * 01_TECH_STACK.md 환경변수 관리 항목 전체를 기동 시점에 검증한다.
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

  // 로그 전용 DB(coupon_platform_log) — 메인 DB와 물리적으로 분리(02_DEV_CONVENTIONS.md 1장).
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

  // RANDOM 코드 대량생성 백그라운드 루프(05_COUPON_ISSUANCE_SCENARIO.md 2.2) — DB 일시 오류
  // 재시도 한도/지연. 코드값 충돌(1062)은 이 설정과 무관하게 무제한 즉시 재시도한다.
  CODE_GENERATION_MAX_DB_RETRIES: Joi.number().integer().min(0).default(5),
  CODE_GENERATION_RETRY_BASE_DELAY_MS: Joi.number()
    .integer()
    .min(1)
    .default(200),

  // POST /campaigns/{id}/codes/abort(05_COUPON_ISSUANCE_SCENARIO.md 2.4) — "얼마나 오래
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
});
