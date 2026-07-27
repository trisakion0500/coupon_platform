import { ResultCode } from './result-code.enum';

/** ResultCode 하나에 대응하는 사용자 메시지 + HTTP 상태코드. */
export interface ErrorEntry {
  message: string;
  httpStatus: number;
}

/**
 * ResultCode별 사용자 메시지와 HTTP 상태코드를 한 곳에서 관리한다. `BusinessException`은
 * 이 맵만 보고 응답을 구성하므로, 새 오류 코드를 추가할 때 이 파일 하나만 갱신하면 된다 —
 * 메시지/상태코드가 여러 파일에 흩어져 따로 관리되는 것을 방지한다.
 *
 * 새 코드의 httpStatus를 정할 때는 10_API_COMMON.md 1.3 매핑 규칙을 따른다:
 * 10000번대→401, 20000번대→403, 31000~31999(Not Found)→404, 그 외 30000번대→400,
 * 40000번대→429, 50000번대→500.
 *
 * @author trisakion
 */
export const ERROR_MAP: Record<ResultCode, ErrorEntry> = {
  // BusinessException은 실패를 표현하는 용도라 SUCCESS로 생성되지 않는다 — Record 타입을
  // 완전하게 채우기 위한 자리채움일 뿐이다.
  [ResultCode.SUCCESS]: { message: 'OK', httpStatus: 200 },

  // 10000 — Authentication
  [ResultCode.LOGIN_FAILED]: {
    message: '로그인에 실패했습니다.',
    httpStatus: 401,
  },
  [ResultCode.PASSWORD_MISMATCH]: {
    message: '비밀번호가 일치하지 않습니다.',
    httpStatus: 401,
  },
  [ResultCode.ACCESS_TOKEN_EXPIRED]: {
    message: 'Access Token이 만료되었습니다.',
    httpStatus: 401,
  },
  [ResultCode.LOGIN_REQUIRED]: {
    message: '로그인이 필요합니다.',
    httpStatus: 401,
  },
  [ResultCode.SIGNUP_PENDING_APPROVAL]: {
    message: '가입 승인 대기 중입니다.',
    httpStatus: 401,
  },
  [ResultCode.SIGNUP_REJECTED]: {
    message: '가입이 반려되었습니다.',
    httpStatus: 401,
  },
  [ResultCode.ACCOUNT_SUSPENDED]: {
    message: '사용이 중지된 계정입니다.',
    httpStatus: 401,
  },
  [ResultCode.REFRESH_TOKEN_EXPIRED]: {
    message: 'Refresh Token이 만료되었습니다.',
    httpStatus: 401,
  },
  [ResultCode.INVALID_SESSION]: {
    message: '유효하지 않은 세션입니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_INVALID_API_KEY]: {
    message: 'API Key가 없거나 유효하지 않습니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_SIGNATURE_MISMATCH]: {
    message: '서명이 일치하지 않습니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_MISSING_AUTH_HEADER]: {
    message: '필수 인증 헤더가 누락되었거나 형식이 올바르지 않습니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_TIMESTAMP_OUT_OF_RANGE]: {
    message: 'Timestamp 허용 범위를 초과했습니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_PROJECT_SUSPENDED]: {
    message: '사용이 중지된 프로젝트입니다.',
    httpStatus: 401,
  },
  [ResultCode.S2S_NONCE_REUSED]: {
    message: '이미 사용된 Nonce입니다(재전송 의심).',
    httpStatus: 401,
  },

  // 20000 — Authorization
  [ResultCode.PERMISSION_DENIED]: {
    message: '권한이 없습니다.',
    httpStatus: 403,
  },

  // 30000 — Validation (입력값)
  [ResultCode.REQUIRED_FIELD_MISSING]: {
    message: '필수 입력값이 누락되었습니다.',
    httpStatus: 400,
  },
  [ResultCode.INVALID_FIELD_FORMAT]: {
    message: '입력값 형식이 올바르지 않습니다.',
    httpStatus: 400,
  },
  [ResultCode.DISALLOWED_VALUE]: {
    message: '허용되지 않는 값입니다.',
    httpStatus: 400,
  },
  [ResultCode.INVALID_STATE_TRANSITION]: {
    message: '현재 상태에서 허용되지 않는 처리입니다.',
    httpStatus: 400,
  },
  [ResultCode.UPDATE_CONFLICT]: {
    message:
      '다른 사용자가 먼저 수정했습니다. 최신 데이터를 다시 불러온 뒤 시도해주세요.',
    httpStatus: 400,
  },

  // 31000 — Validation (Not Found)
  [ResultCode.COMPANY_NOT_FOUND]: {
    message: '존재하지 않는 회사입니다.',
    httpStatus: 404,
  },
  [ResultCode.PROJECT_NOT_FOUND]: {
    message: '존재하지 않는 프로젝트입니다.',
    httpStatus: 404,
  },
  [ResultCode.USER_NOT_FOUND]: {
    message: '사용자를 찾을 수 없습니다.',
    httpStatus: 404,
  },
  [ResultCode.CAMPAIGN_NOT_FOUND]: {
    message: '존재하지 않는 캠페인입니다.',
    httpStatus: 404,
  },
  [ResultCode.COUPON_CODE_NOT_FOUND]: {
    message: '존재하지 않는 쿠폰 코드입니다.',
    httpStatus: 404,
  },
  [ResultCode.USAGE_NOT_FOUND]: {
    message: '소모 기록이 없습니다.',
    httpStatus: 404,
  },
  [ResultCode.USER_ROLE_NOT_FOUND]: {
    message: '사용자 권한 배정이 없습니다.',
    httpStatus: 404,
  },
  [ResultCode.LOG_AUDIT_NOT_FOUND]: {
    message: '존재하지 않는 감사 로그입니다.',
    httpStatus: 404,
  },

  // 32000 — Validation (중복)
  [ResultCode.DUPLICATE_DATA]: {
    message: '이미 사용 중인 값입니다.',
    httpStatus: 400,
  },

  // 33000 — Validation (쿠폰 사용 제약)
  [ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED]: {
    message: '이미 사용되었거나 중지된 쿠폰 코드입니다.',
    httpStatus: 400,
  },
  [ResultCode.CAMPAIGN_NOT_USABLE]: {
    message: '사용할 수 없는 캠페인입니다.',
    httpStatus: 400,
  },
  [ResultCode.USER_USE_LIMIT_EXCEEDED]: {
    message: '사용자 사용 한도를 초과했습니다.',
    httpStatus: 400,
  },

  // 40000 — Rate Limit
  [ResultCode.RATE_LIMIT_EXCEEDED]: {
    message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
    httpStatus: 429,
  },

  // 50000 — System
  [ResultCode.INTERNAL_ERROR]: {
    message: '서버 오류가 발생했습니다.',
    httpStatus: 500,
  },
  [ResultCode.DATABASE_ERROR]: {
    message: 'DB 오류가 발생했습니다.',
    httpStatus: 500,
  },
  // 10_API_COMMON.md 1.3 예외 — System 범위지만 500이 아니라 408을 쓴다(요청 자체는
  // 정상이었고 처리 시간 초과가 원인이라는 걸 클라이언트가 구분할 수 있어야 함).
  [ResultCode.API_EXECUTION_TIMEOUT]: {
    message: '요청 처리 시간이 초과되었습니다.',
    httpStatus: 408,
  },
};
