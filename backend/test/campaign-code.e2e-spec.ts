import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { CampaignResponseDto } from '../src/campaign/dto/campaign-response.dto';
import {
  CodeListItemDto,
  IssueCodesResultDto,
} from '../src/campaign/dto/code-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

const PROJECT_ID = 2; // DEV_PROJECT — mgr/op 둘 다 여기 배정돼 있다.

function createCampaignPayload(
  name: string,
  codeType: 1 | 2,
  requestedQty: number,
) {
  return {
    project_id: PROJECT_ID,
    name,
    campaign_start: '2026-08-01 00:00:00',
    campaign_end: '2026-08-31 23:59:59',
    code_type: codeType,
    requested_qty: requestedQty,
    reward_data: { item_id: 1001, item_amount: 100 },
  };
}

/**
 * 17_CAMPAIGN_API.md 3장(Coupon Code Issuance) 4개 엔드포인트 E2E — FIXED 동기 발급, RANDOM
 * 비동기 대량생성(백그라운드 완료까지 폴링), 재시도, 중단(abort), 코드 목록 조회. `CampaignService`
 * (2장 CRUD/승인)와 분리된 `CampaignCodeService` 경계를 그대로 따라 별도 파일로 뒀다
 * (`campaign.e2e-spec.ts` 참고).
 *
 * @author trisakion
 */
describe('Campaign Code Issuance E2E (17_CAMPAIGN_API.md 3장)', () => {
  let app: INestApplication;
  let mgrAccessToken: string;
  let opAccessToken: string;

  beforeAll(async () => {
    app = await createE2eApp();

    const login = async (loginId: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: loginId, password: '1234' })
        .expect(200);
      return success<LoginResponseDto>(res).data.access_token;
    };

    mgrAccessToken = await login('mgr');
    opAccessToken = await login('op');
  });

  afterAll(async () => {
    await app.close();
  });

  const createCampaign = async (
    name: string,
    codeType: 1 | 2,
    requestedQty: number,
  ): Promise<CampaignResponseDto> => {
    const res = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${mgrAccessToken}`)
      .send(createCampaignPayload(name, codeType, requestedQty))
      .expect(200);
    return success<CampaignResponseDto>(res).data;
  };

  /** RANDOM 백그라운드 대량생성이 끝날 때까지 GET /campaigns/:id를 짧은 간격으로 폴링한다. */
  const waitForGenerationStatus = async (
    campaignId: number,
    targetStatuses: number[],
    timeoutMs = 10000,
  ): Promise<CampaignResponseDto> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const body = success<CampaignResponseDto>(res).data;
      if (targetStatuses.includes(body.generation_status)) return body;
      if (Date.now() > deadline) {
        throw new Error(
          `generation_status가 ${targetStatuses.toString()}로 끝나길 기다렸지만 타임아웃(마지막 값=${body.generation_status})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  describe('FIXED — 동기 즉시 완료(200)', () => {
    it('code_value를 주고 발급하면 즉시 완료되고 그 코드가 반환된다', async () => {
      const campaign = await createCampaign('E2E FIXED 캠페인', 2, 5);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ code_value: 'E2E_FIXED_CODE_1' })
        .expect(200);

      const body = success<IssueCodesResultDto>(res);
      expect(body.data.generation_status).toBe(3); // 완료
      expect(body.data.generated_qty).toBe(5); // FIXED는 requested_qty를 그대로 총사용가능횟수로
      expect(body.data.coupon_code?.code_value).toBe('E2E_FIXED_CODE_1');

      const listRes = await request(app.getHttpServer())
        .get(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const listBody = success<PaginatedResult<CodeListItemDto>>(listRes);
      expect(listBody.data.items).toHaveLength(1);
      expect(listBody.data.items[0].code_value).toBe('E2E_FIXED_CODE_1');
    });

    it('code_value 없이 FIXED 캠페인에 발급 요청하면 REQUIRED_FIELD_MISSING(30001)', async () => {
      const campaign = await createCampaign('E2E FIXED 코드누락', 2, 5);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.REQUIRED_FIELD_MISSING);
    });

    it('같은 프로젝트 내 중복 code_value는 DUPLICATE_DATA(32001)', async () => {
      const campaign = await createCampaign('E2E FIXED 코드중복', 2, 5);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ code_value: 'E2E_FIXED_CODE_1' }) // 위 첫 테스트에서 이미 사용된 값
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });

    it('완료된 캠페인에 재시도(retry)를 걸면 INVALID_STATE_TRANSITION(30004)', async () => {
      const campaign = await createCampaign('E2E FIXED 재시도불가', 2, 5);
      await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ code_value: 'E2E_FIXED_CODE_RETRY_TEST' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes/retry`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });
  });

  describe('RANDOM — 비동기 백그라운드 대량생성(202)', () => {
    it('발급 요청은 즉시 202로 응답하고, 백그라운드에서 requested_qty만큼 완료된다', async () => {
      const campaign = await createCampaign('E2E RANDOM 캠페인', 1, 5);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(202);
      const body = success<IssueCodesResultDto>(res);
      expect(body.data.generation_status).toBe(2); // 선점 직후 즉시 응답 — 아직 진행중
      expect(body.data.coupon_code).toBeUndefined();

      const finished = await waitForGenerationStatus(
        campaign.coupon_campaign_id,
        [3, 4],
      );
      expect(finished.generation_status).toBe(3);
      expect(finished.generated_qty).toBe(5);

      const listRes = await request(app.getHttpServer())
        .get(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      expect(
        success<PaginatedResult<CodeListItemDto>>(listRes).data.total_count,
      ).toBe(5);
    });

    it('완료된 캠페인에 재시도(retry)를 걸면 INVALID_STATE_TRANSITION(30004)', async () => {
      const campaign = await createCampaign('E2E RANDOM 재시도불가', 1, 3);
      await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(202);
      await waitForGenerationStatus(campaign.coupon_campaign_id, [3, 4]);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes/retry`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });
  });

  describe('POST /campaigns/:id/codes/abort — 정체 복구(SUPER_ADMIN/DEVELOPER/MANAGER 전용)', () => {
    it('아직 정체된 게 아닌(방금 시작한) 진행중 job은 INVALID_STATE_TRANSITION(30004)로 거부된다', async () => {
      const campaign = await createCampaign('E2E RANDOM abort 안전장치', 1, 5);
      await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(202);

      // 방금 시작한 job이라 updated_at이 신선하다 — SP가 "아직 살아있을 가능성이 높다"고 보고
      // 정체가 아니라고 판단해야 한다(05_COUPON_ISSUANCE_SCENARIO.md 2.4 핵심 안전장치).
      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes/abort`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);

      // 백그라운드 루프가 계속 돌게 두고 정상 완료까지 기다려 다음 테스트에 영향 없게 정리한다.
      await waitForGenerationStatus(campaign.coupon_campaign_id, [3, 4]);
    });

    it('OPERATOR는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const campaign = await createCampaign('E2E abort 권한거부', 1, 5);
      await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(202);

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaign.coupon_campaign_id}/codes/abort`)
        .set('Authorization', `Bearer ${opAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);

      await waitForGenerationStatus(campaign.coupon_campaign_id, [3, 4]);
    });
  });

  describe('존재하지 않는 캠페인', () => {
    it('발급/재시도/목록조회/중단 전부 CAMPAIGN_NOT_FOUND(31004)', async () => {
      const issueRes = await request(app.getHttpServer())
        .post('/campaigns/999999/codes')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({})
        .expect(404);
      expect(failure(issueRes).result).toBe(ResultCode.CAMPAIGN_NOT_FOUND);

      const retryRes = await request(app.getHttpServer())
        .post('/campaigns/999999/codes/retry')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(404);
      expect(failure(retryRes).result).toBe(ResultCode.CAMPAIGN_NOT_FOUND);

      const listRes = await request(app.getHttpServer())
        .get('/campaigns/999999/codes')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(404);
      expect(failure(listRes).result).toBe(ResultCode.CAMPAIGN_NOT_FOUND);

      const abortRes = await request(app.getHttpServer())
        .post('/campaigns/999999/codes/abort')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(404);
      expect(failure(abortRes).result).toBe(ResultCode.CAMPAIGN_NOT_FOUND);
    });
  });
});
