import { createHmac, randomUUID } from 'crypto';

/**
 * coupon_platform S2S(Server-to-Server) 쿠폰 사용 API 연동 SDK — 입점사(게임사)가 그대로
 * 가져다 쓸 수 있는 독립 산출물이다(docs/21_TEST_GAME_SERVER.md 9장).
 *
 * - 외부 의존성 0개: Node.js 22 LTS 내장 `crypto`(HMAC 서명)와 전역 `fetch`(HTTP 호출)만 쓴다.
 * - 입력은 항상 평문 `apiKey`/`apiSecret`이다 — 이 파일 자체에는 복호화 로직이 없다. DB에서 읽은
 *   암호문을 다루는 코드는 이 SDK와 완전히 분리된 별도 계층(test_game_server의 testing/ 폴더)에서만
 *   쓰이고, 그 결과(평문)만 이 클라이언트 생성자에 넘긴다.
 * - 서명 규칙은 09_AUTH_SECURITY.md 2.3, backend의 `S2sAuthGuard.buildStringToSign`과 동일하다 —
 *   그 파일을 import하지 않고 이 SDK 안에 자체 구현했다(테스트 코드에 대한 의존을 배포 산출물에
 *   남기지 않기 위함).
 */

export interface CouponS2sClientOptions {
  /** 예: https://coupon-api.example.com (끝에 슬래시 없이) */
  baseUrl: string;
  apiKey: string;
  /** 평문 API Secret — 발급/재발급 API 응답으로 1회 노출된 값을 그대로 사용한다. */
  apiSecret: string;
}

export interface ReserveResult {
  coupon_code_usage_id: number;
  coupon_campaign_id: number;
  code_value: string;
  game_user_id: string;
  reward_data: unknown;
  created_at: string;
}

export interface ConfirmResult {
  coupon_code_usage_id: number;
  confirmed_at: string;
}

export interface UnconfirmedItem {
  code_value: string;
  game_user_id: string;
  coupon_campaign_id: number;
  reward_data: unknown;
  created_at: string;
}

export interface UnconfirmedResultSingleUser {
  items: UnconfirmedItem[];
}

export interface UnconfirmedResultPaginated {
  page: number;
  page_size: number;
  total_count: number;
  items: UnconfirmedItem[];
}

export type UnconfirmedResult =
  | UnconfirmedResultSingleUser
  | UnconfirmedResultPaginated;

export interface GetUnconfirmedParams {
  /** 지정 시 특정유저 조회 모드(페이지네이션 없음). 미지정 시 전체유저 조회 모드(page/pageSize 필수). */
  gameUserId?: string;
  campaignId?: number;
  page?: number;
  pageSize?: number;
}

/** API가 `{result !== 0}`을 반환했을 때 던지는 에러 — 입점사가 `resultCode`로 분기하기 위함. */
export class CouponApiError extends Error {
  constructor(
    public readonly resultCode: number,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'CouponApiError';
  }
}

export class CouponS2sClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(options: CouponS2sClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
  }

  /**
   * `POST /v1/coupons/{code}/reserve` — 20_COUPON_USAGE_API.md 2.1. 성공 시 즉시 최종 소모
   * 확정이다(예약 중간 상태 없음) — 응답을 못 받아 재시도할 때의 동작이 캠페인 설정에 따라
   * 달라지므로 반드시 알아두어야 한다:
   *
   * - **`use_limit_per_user`가 1인 캠페인(RANDOM/FIXED 공통)**: 동일한 `codeValue`+`gameUserId`로
   *   재시도하면 새로 소모하지 않고 최초 성공 때와 **완전히 동일한 응답**(같은
   *   `coupon_code_usage_id`/`reward_data`)을 그대로 재반환한다(멱등) — 네트워크 타임아웃 등으로
   *   응답을 못 받았을 때 안전하게 재시도해도 된다.
   * - **`use_limit_per_user`가 1보다 큰 캠페인(FIXED만 해당)**: "재시도"와 "정당한 반복 사용"을
   *   서버가 구분할 방법이 없어 멱등 처리가 적용되지 않는다 — 재시도도 그냥 새로운 소모 1건으로
   *   카운트된다(한도 안이면 새 `coupon_code_usage_id`로 성공, 한도를 넘으면 `33003`). 이런
   *   캠페인에서 응답을 못 받은 요청을 무작정 재시도하면 의도치 않게 사용자의 한도를 두 번
   *   소모시킬 수 있다 — 재시도 전에 `getUnconfirmed()`로 실제 소모 여부를 먼저 확인하는 것을
   *   권장한다.
   */
  async reserve(codeValue: string, gameUserId: string): Promise<ReserveResult> {
    return this.request<ReserveResult>(
      `/v1/coupons/${encodeURIComponent(codeValue)}/reserve`,
      { game_user_id: gameUserId },
    );
  }

  /** `POST /v1/coupons/{code}/confirm` — 20_COUPON_USAGE_API.md 2.2 */
  async confirm(codeValue: string, gameUserId: string): Promise<ConfirmResult> {
    return this.request<ConfirmResult>(
      `/v1/coupons/${encodeURIComponent(codeValue)}/confirm`,
      { game_user_id: gameUserId },
    );
  }

  /**
   * `POST /v1/coupons/unconfirmed` — 20_COUPON_USAGE_API.md 3.1. 조회 전용이지만 GET이 아니라
   * POST다(2026-07-27 변경) — GET 쿼리스트링에 `game_user_id` 등을 실으면 웹서버/프록시/CDN
   * 접근 로그에 그대로 남기 쉬워, 나머지 두 엔드포인트와 동일하게 바디로 받도록 통일했다.
   */
  async getUnconfirmed(params: GetUnconfirmedParams = {}): Promise<UnconfirmedResult> {
    const body: Record<string, unknown> = {};
    if (params.gameUserId !== undefined) body.game_user_id = params.gameUserId;
    if (params.campaignId !== undefined) body.campaign_id = params.campaignId;
    if (params.page !== undefined) body.page = params.page;
    if (params.pageSize !== undefined) body.page_size = params.pageSize;

    return this.request<UnconfirmedResult>('/v1/coupons/unconfirmed', body);
  }

  /**
   * 서명 생성 + HTTP 호출 + 응답 파싱을 한 곳에 모은 내부 헬퍼. 3개 엔드포인트 전부 POST+바디라
   * HTTP 메서드를 인자로 받지 않는다. `path`는 caller가 넘긴 문자열을 그대로 서명(`stringToSign`)과
   * 실제 fetch URL 양쪽에 동일하게 쓴다 — 서버(Express `request.path`)는 퍼센트 디코딩을
   * 하지 않으므로(`req.path`는 인코딩된 문자열 그대로다), 클라이언트가 보낸 그대로의 문자열이
   * 서명 검증 기준과 일치해야 한다. reserve/confirm이 이 메서드에 넘기는 path는 이미
   * `encodeURIComponent`를 거친 상태인데, 코드값이 URL-safe 문자(nanoid 알파벳/하이픈)로만
   * 구성되면 인코딩 전후가 동일해 실질적으로 문제가 없다.
   */
  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const bodyString = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const stringToSign = ['POST', path, '', timestamp, nonce, bodyString].join('\n');
    const signature = createHmac('sha256', this.apiSecret)
      .update(stringToSign)
      .digest('hex');

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-API-Timestamp': timestamp,
        'X-API-Nonce': nonce,
        'X-API-Signature': signature,
      },
      body: bodyString,
    });

    const json = (await response.json()) as { result: number; data?: T; message?: string };

    if (json.result !== 0) {
      throw new CouponApiError(
        json.result,
        response.status,
        json.message ?? `coupon API error (result=${json.result})`,
      );
    }

    return json.data as T;
  }
}
