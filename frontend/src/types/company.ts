import type { PaginationQuery } from '@/types/api';

/** 12_COMPANY_API.md 2장 — `company` 원본 컬럼. status: 1=사용, 0=중지. */
export interface Company {
  company_id: number;
  company_code: string;
  company_name: string;
  description: string | null;
  status: number;
  created_at: string;
  updated_at: string;
}

/** 12_COMPANY_API.md 2.2 GET /companies 쿼리 파라미터. */
export interface CompanyListQuery extends PaginationQuery {
  status?: number;
}

/** 12_COMPANY_API.md 2.1 POST /companies 요청. */
export interface CreateCompanyRequest {
  company_code: string;
  company_name: string;
  description?: string;
}

/** 12_COMPANY_API.md 2.4 PATCH /companies/{company_id} 요청 — 전부 선택 입력. */
export interface UpdateCompanyRequest {
  company_code?: string;
  company_name?: string;
  description?: string;
  status?: number;
}
