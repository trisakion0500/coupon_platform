import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  Company,
  CompanyListQuery,
  CreateCompanyRequest,
  UpdateCompanyRequest,
} from '@/types/company';
import type { ActiveHeaderData } from '@/types/header';

/** 12_COMPANY_API.md 2.2. */
export async function listCompanies(
  query: CompanyListQuery,
): Promise<PaginatedResult<Company>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<Company>>>(
    '/companies',
    { params: query },
  );
  return data.data;
}

/** 12_COMPANY_API.md 2.3. */
export async function getCompany(companyId: number): Promise<Company> {
  const { data } = await apiClient.get<ApiEnvelope<Company>>(
    `/companies/${companyId}`,
  );
  return data.data;
}

/** 12_COMPANY_API.md 2.1. */
export async function createCompany(
  dto: CreateCompanyRequest,
): Promise<Company> {
  const { data } = await apiClient.post<ApiEnvelope<Company>>(
    '/companies',
    dto,
  );
  return data.data;
}

/** 12_COMPANY_API.md 2.4. */
export async function updateCompany(
  companyId: number,
  dto: UpdateCompanyRequest,
): Promise<Company> {
  const { data } = await apiClient.patch<ApiEnvelope<Company>>(
    `/companies/${companyId}`,
    dto,
  );
  return data.data;
}

/** 12_COMPANY_API.md 3.1 — 로그인 시 1회 로드하는 헤더 콤보박스용 활성 회사/프로젝트 목록. */
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

/** 12_COMPANY_API.md 2.5 — 회원가입 화면 전용, 인증 불필요. 미존재/비활성 시 31001. */
export async function lookupCompany(
  companyCode: string,
): Promise<CompanyLookupResponse> {
  const { data } = await apiClient.get<ApiEnvelope<CompanyLookupResponse>>(
    '/companies/lookup',
    { params: { company_code: companyCode } },
  );
  return data.data;
}
