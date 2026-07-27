import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import type { ApiEnvelope, ApiErrorBody } from '@/types/api';
import type { RefreshResponse } from '@/types/auth';

/**
 * 10_API_COMMON.md 1장 공통 응답 봉투를 다루는 axios 인스턴스. 요청 인터셉터가
 * `authStore.accessToken`을 매번 `Authorization` 헤더에 실어 보내고, 응답 인터셉터가
 * Access Token 만료(10003)를 감지하면 `/auth/refresh`로 자동 재발급 후 원 요청을 1회
 * 재시도한다(그 이상 반복하면 무한루프가 되므로 요청당 1회만).
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

const ACCESS_TOKEN_EXPIRED = 10003;

/** 재시도 표식이 붙은 요청 config — 재발급 후에도 또 10003이 나면 더 이상 재시도하지 않는다. */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

/** 재발급 API 자체는 이 인스턴스를 쓰지 않는다 — accessToken 부착/401 가로채기가 불필요. */
const refreshClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

let refreshPromise: Promise<string> | null = null;

/**
 * 동시에 여러 요청이 401을 맞아도 `/auth/refresh` 호출은 1번만 나가도록 진행 중인 재발급
 * Promise를 공유한다(요청별로 각자 재발급을 트리거하면 refresh_token이 회전하는 서버라면
 * 경쟁이 생길 수 있음 — 09_AUTH_SECURITY.md 참고).
 */
async function refreshAccessToken(): Promise<string> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    throw new Error('no refresh token available');
  }

  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<ApiEnvelope<RefreshResponse>>('/auth/refresh', {
        refresh_token: refreshToken,
      })
      .then(({ data }) => {
        useAuthStore
          .getState()
          .setAccessToken(data.data.access_token, data.data.role_code);
        return data.data.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetryableConfig | undefined;
    const resultCode = error.response?.data?.result;

    if (
      error.response?.status === 401 &&
      resultCode === ACCESS_TOKEN_EXPIRED &&
      config &&
      !config._retried
    ) {
      config._retried = true;
      try {
        const accessToken = await refreshAccessToken();
        config.headers.set('Authorization', `Bearer ${accessToken}`);
        return apiClient(config);
      } catch {
        // 재발급 자체가 실패(Refresh Token 만료/무효)하면 세션을 정리하고 로그인 화면으로
        // 보낸다 — router 밖이라 history를 직접 조작하지 않고 location으로 강제 이동한다.
        useAuthStore.getState().clear();
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  },
);
