import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  ApproveCampaignRequest,
  Campaign,
  CampaignListItem,
  CampaignListQuery,
  CampaignLog,
  CampaignLogListQuery,
  ChangeCampaignStatusRequest,
  CodeJobStatusResult,
  CodeListQuery,
  CouponCode,
  CreateCampaignRequest,
  IssueCodesRequest,
  IssueCodesResult,
  RejectCampaignRequest,
  UpdateCampaignRequest,
  UsageListQuery,
  CampaignUsage,
} from '@/types/campaign';

/** 17_CAMPAIGN_API.md 2.1. */
export async function createCampaign(dto: CreateCampaignRequest): Promise<Campaign> {
  const { data } = await apiClient.post<ApiEnvelope<Campaign>>('/campaigns', dto);
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.2. */
export async function listCampaigns(
  query: CampaignListQuery,
): Promise<PaginatedResult<CampaignListItem>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<CampaignListItem>>>(
    '/campaigns',
    { params: query },
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.3. */
export async function getCampaign(campaignId: number): Promise<Campaign> {
  const { data } = await apiClient.get<ApiEnvelope<Campaign>>(
    `/campaigns/${campaignId}`,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.4 — edit_count 낙관적 락 필수. */
export async function updateCampaign(
  campaignId: number,
  dto: UpdateCampaignRequest,
): Promise<Campaign> {
  const { data } = await apiClient.patch<ApiEnvelope<Campaign>>(
    `/campaigns/${campaignId}`,
    dto,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.5 — edit_count 낙관적 락 필수. */
export async function changeCampaignStatus(
  campaignId: number,
  dto: ChangeCampaignStatusRequest,
): Promise<Campaign> {
  const { data } = await apiClient.post<ApiEnvelope<Campaign>>(
    `/campaigns/${campaignId}/status`,
    dto,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.6 — SUPER_ADMIN/DEVELOPER/MANAGER만(OPERATOR 승인 불가). */
export async function approveCampaign(
  campaignId: number,
  dto: ApproveCampaignRequest,
): Promise<Campaign> {
  const { data } = await apiClient.post<ApiEnvelope<Campaign>>(
    `/campaigns/${campaignId}/approve`,
    dto,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 2.7 — SUPER_ADMIN/DEVELOPER/MANAGER만. */
export async function rejectCampaign(
  campaignId: number,
  dto: RejectCampaignRequest,
): Promise<Campaign> {
  const { data } = await apiClient.post<ApiEnvelope<Campaign>>(
    `/campaigns/${campaignId}/reject`,
    dto,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 3.1 — RANDOM은 body 없이 호출(백엔드가 202로 응답), FIXED는 code_value 필수. */
export async function issueCodes(
  campaignId: number,
  dto?: IssueCodesRequest,
): Promise<IssueCodesResult> {
  const { data } = await apiClient.post<ApiEnvelope<IssueCodesResult>>(
    `/campaigns/${campaignId}/codes`,
    dto ?? {},
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 3.2 — generation_status=4(실패)일 때만 허용. */
export async function retryCodeIssuance(
  campaignId: number,
): Promise<CodeJobStatusResult> {
  const { data } = await apiClient.post<ApiEnvelope<CodeJobStatusResult>>(
    `/campaigns/${campaignId}/codes/retry`,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 3.4 — SUPER_ADMIN/DEVELOPER/MANAGER만(OPERATOR 불가), 정체 판정 미충족 시 30004. */
export async function abortCodeGeneration(
  campaignId: number,
): Promise<CodeJobStatusResult> {
  const { data } = await apiClient.post<ApiEnvelope<CodeJobStatusResult>>(
    `/campaigns/${campaignId}/codes/abort`,
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 3.3. */
export async function listCodes(
  campaignId: number,
  query: CodeListQuery,
): Promise<PaginatedResult<CouponCode>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<CouponCode>>>(
    `/campaigns/${campaignId}/codes`,
    { params: query },
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 4.1 — 조회 전용, 승인/종료여부 무관. */
export async function listUsages(
  campaignId: number,
  query: UsageListQuery,
): Promise<PaginatedResult<CampaignUsage>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<CampaignUsage>>>(
    `/campaigns/${campaignId}/usages`,
    { params: query },
  );
  return data.data;
}

/** 17_CAMPAIGN_API.md 4.2 — 조회 전용, 승인/종료여부 무관. */
export async function listCampaignLogs(
  campaignId: number,
  query: CampaignLogListQuery,
): Promise<PaginatedResult<CampaignLog>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<CampaignLog>>>(
    `/campaigns/${campaignId}/logs`,
    { params: query },
  );
  return data.data;
}
