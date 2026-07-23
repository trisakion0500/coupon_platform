import axios from 'axios';
import type { ApiErrorBody } from '@/types/api';

/** 08_API_COMMON.md 1.4 — 실패 응답에서 result 코드를 뽑아낸다(성공 응답과 구분 못 할 때 null). */
export function getResultCode(error: unknown): number | null {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.result ?? null;
  }
  return null;
}

/** 서버가 내려준 message, 없으면 일반적인 문구로 대체. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.message ?? '요청 처리 중 오류가 발생했습니다.';
  }
  return '요청 처리 중 오류가 발생했습니다.';
}
