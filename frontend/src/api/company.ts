import { apiClient } from '@/api/client';
import type { ApiEnvelope } from '@/types/api';
import type { ActiveHeaderData } from '@/types/header';

/** 10_COMPANY_API.md 3.1 — 로그인 시 1회 로드하는 헤더 콤보박스용 활성 회사/프로젝트 목록. */
export async function getActiveHeaderData(): Promise<ActiveHeaderData> {
  const { data } = await apiClient.get<ApiEnvelope<ActiveHeaderData>>(
    '/companies/active-header-data',
  );
  return data.data;
}

interface CompanyLookupResponse {
  company_id: number;
  company_name: string;
}

/** 10_COMPANY_API.md 2.5 — 회원가입 화면 전용, 인증 불필요. 미존재/비활성 시 31001. */
export async function lookupCompany(
  companyCode: string,
): Promise<CompanyLookupResponse> {
  const { data } = await apiClient.get<ApiEnvelope<CompanyLookupResponse>>(
    '/companies/lookup',
    { params: { company_code: companyCode } },
  );
  return data.data;
}
