/** 10_COMPANY_API.md 3.1 GET /companies/active-header-data 응답의 companies 배열 항목. */
export interface ActiveCompany {
  company_id: number;
  company_name: string;
}

/** 10_COMPANY_API.md 3.1 GET /companies/active-header-data 응답의 projects 배열 항목. */
export interface ActiveProject {
  project_id: number;
  company_id: number;
  project_name: string;
}

/** 10_COMPANY_API.md 3.1 GET /companies/active-header-data 응답 전체. */
export interface ActiveHeaderData {
  companies: ActiveCompany[];
  projects: ActiveProject[];
}
