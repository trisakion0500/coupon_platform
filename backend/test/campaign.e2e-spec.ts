import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import {
  CampaignListItemDto,
  CampaignLogListItemDto,
  CampaignResponseDto,
  UsageListItemDto,
} from '../src/campaign/dto/campaign-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

const PROJECT_ID = 2; // DEV_PROJECT — mgr(MANAGER)/op(OPERATOR) 둘 다 여기 배정돼 있다.

/** 17_CAMPAIGN_API.md 2.1 요청 바디 공통 부분 — 이름만 바꿔 여러 캠페인을 만든다. */
function createCampaignPayload(name: string) {
  return {
    project_id: PROJECT_ID,
    name,
    campaign_start: '2026-08-01 00:00:00',
    campaign_end: '2026-08-31 23:59:59',
    code_type: 1, // RANDOM
    requested_qty: 10,
    reward_data: { item_id: 1001, item_amount: 100 },
  };
}

/**
 * 17_CAMPAIGN_API.md 2장(CRUD+상태변경+승인워크플로우) + 4장(사용이력/변경이력 조회) E2E.
 * 코드발급(3장, RANDOM 비동기/FIXED 동기/재시도/중단)은 별도 `campaign-code.e2e-spec.ts`에서
 * 다룬다(백엔드가 `CampaignService`/`CampaignCodeService`로 분리돼 있는 것과 동일한 경계).
 *
 * 이 도메인의 핵심은 **role_code 기반 승인상태 자동결정**(MANAGER 이하=승인불요/OPERATOR=승인대기)과
 * **OPERATOR가 승인완료/반려된 캠페인을 수정하면 승인상태가 승인대기로 자동 재전환되는 부수효과**
 * (2026-07-20 확정 규칙)라, 두 규칙 다 실제로 재현해서 검증한다.
 *
 * @author trisakion
 */
describe('Campaign E2E (17_CAMPAIGN_API.md 2/4장)', () => {
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

  describe('POST /campaigns — 생성 시 role_code에 따라 승인상태가 자동 결정된다', () => {
    it('MANAGER(role_code=30)가 만들면 승인불요(approval_status=1)로 즉시 생성된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send(createCampaignPayload('E2E MGR 캠페인'))
        .expect(200);

      const body = success<CampaignResponseDto>(res);
      expect(body.data.approval_status).toBe(1);
      expect(body.data.status).toBe(1); // 신규 생성은 항상 대기
      expect(body.data.edit_count).toBe(0);
    });

    it('OPERATOR(role_code=40)가 만들면 승인대기(approval_status=2)로 생성된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E OP 캠페인'))
        .expect(200);
      expect(success<CampaignResponseDto>(res).data.approval_status).toBe(2);
    });

    it('존재하지 않는 project_id는 PROJECT_NOT_FOUND(31002)', async () => {
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ ...createCampaignPayload('유령 프로젝트'), project_id: 999999 })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.PROJECT_NOT_FOUND);
    });

    it('campaign_end가 campaign_start보다 빠르면 400(INVALID_FIELD_FORMAT)', async () => {
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({
          ...createCampaignPayload('잘못된 기간'),
          campaign_start: '2026-08-31 00:00:00',
          campaign_end: '2026-08-01 00:00:00',
        })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_FIELD_FORMAT);
    });
  });

  describe('CRUD/상태변경/승인워크플로우 — 캠페인 하나의 생애주기', () => {
    let campaignId: number;
    let editCount: number;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send(createCampaignPayload('E2E 생애주기 캠페인'))
        .expect(200);
      const body = success<CampaignResponseDto>(res).data;
      campaignId = body.coupon_campaign_id;
      editCount = body.edit_count;
    });

    it('GET /campaigns/:id — 상세 조회가 가능하다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      expect(success<CampaignResponseDto>(res).data.name).toBe(
        'E2E 생애주기 캠페인',
      );
    });

    it('존재하지 않는 ID는 CAMPAIGN_NOT_FOUND(31004)', async () => {
      const res = await request(app.getHttpServer())
        .get('/campaigns/999999')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.CAMPAIGN_NOT_FOUND);
    });

    it('GET /campaigns — project_id로 목록 조회 시 방금 만든 캠페인이 포함된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .query({ project_id: PROJECT_ID })
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<CampaignListItemDto>>(res);
      expect(
        body.data.items.some((c) => c.coupon_campaign_id === campaignId),
      ).toBe(true);
    });

    it('PATCH /campaigns/:id — 올바른 edit_count로 수정하면 edit_count가 증가한다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, name: 'E2E 생애주기 캠페인(수정됨)' })
        .expect(200);
      const body = success<CampaignResponseDto>(res);
      expect(body.data.name).toBe('E2E 생애주기 캠페인(수정됨)');
      editCount = body.data.edit_count;
      expect(editCount).toBe(1);
    });

    it('오래된 edit_count로 재수정하면 UPDATE_CONFLICT(30005)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: 0, name: '충돌해야 함' })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.UPDATE_CONFLICT);
    });

    it('POST /campaigns/:id/status — 승인불요 캠페인은 바로 활성화(1→2)할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, status: 2 })
        .expect(200);
      const body = success<CampaignResponseDto>(res);
      expect(body.data.status).toBe(2);
      editCount = body.data.edit_count;
    });

    it('활성 상태에서 일시중지(2→3), 재활성화(3→2)가 가능하다', async () => {
      const pauseRes = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, status: 3 })
        .expect(200);
      editCount = success<CampaignResponseDto>(pauseRes).data.edit_count;

      const reactivateRes = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, status: 2 })
        .expect(200);
      const body = success<CampaignResponseDto>(reactivateRes);
      expect(body.data.status).toBe(2);
      editCount = body.data.edit_count;
    });

    it('오래된 edit_count로 상태변경하면 UPDATE_CONFLICT(30005)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: 0, status: 3 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.UPDATE_CONFLICT);
    });

    it('종료(2→4) 이후에는 재활성화 시도가 INVALID_STATE_TRANSITION(30004)', async () => {
      const endRes = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, status: 4 })
        .expect(200);
      editCount = success<CampaignResponseDto>(endRes).data.edit_count;

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${campaignId}/status`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: editCount, status: 2 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });

    it('GET /campaigns/:id/usages — 사용 이력이 없으면 빈 목록을 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}/usages`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<UsageListItemDto>>(res);
      expect(body.data.total_count).toBe(0);
      expect(body.data.items).toEqual([]);
    });

    it('GET /campaigns/:id/logs — CREATE/UPDATE/STATUS_CHANGE 이력이 시간순으로 남는다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}/logs`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<CampaignLogListItemDto>>(res);
      const actions = body.data.items.map((l) => l.action);
      expect(actions).toEqual(expect.arrayContaining([10, 20, 30]));
      // 2026-07-23에 SP_CAMPAIGN_CHANGE_STATUS(action=30)만 created_by_name이 NULL로 새던
      // 문서-구현 이격이 있었다 — 전체 액션에 대해 채워져 있는지 회귀 확인.
      expect(
        body.data.items.every((l) => l.created_by_name === 'Manager'),
      ).toBe(true);
    });

    it('action 필터를 주면 해당 작업유형만 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/campaigns/${campaignId}/logs`)
        .query({ action: 10 })
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);
      const body = success<PaginatedResult<CampaignLogListItemDto>>(res);
      expect(body.data.items.every((l) => l.action === 10)).toBe(true);
      expect(body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('승인/반려 워크플로우 — OPERATOR가 만든 캠페인을 MANAGER가 처리', () => {
    it('OPERATOR는 승인/반려 시도 자체가 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E 승인거부 캠페인'))
        .expect(200);
      const created = success<CampaignResponseDto>(createRes).data;

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/approve`)
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send({ edit_count: created.edit_count })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('MANAGER가 승인하면 approval_status=3(승인완료)이 된다', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E 승인성공 캠페인'))
        .expect(200);
      const created = success<CampaignResponseDto>(createRes).data;

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/approve`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: created.edit_count })
        .expect(200);
      expect(success<CampaignResponseDto>(res).data.approval_status).toBe(3);
    });

    it('MANAGER가 반려하면 approval_status=4(반려)와 reject_reason이 저장된다', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E 반려 캠페인'))
        .expect(200);
      const created = success<CampaignResponseDto>(createRes).data;

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/reject`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({
          edit_count: created.edit_count,
          reject_reason: '보상 내용이 정책에 맞지 않습니다.',
        })
        .expect(200);
      const body = success<CampaignResponseDto>(res);
      expect(body.data.approval_status).toBe(4);
      expect(body.data.reject_reason).toBe('보상 내용이 정책에 맞지 않습니다.');
    });

    it('이미 처리된(승인대기 아님) 캠페인을 다시 승인하면 INVALID_STATE_TRANSITION(30004)', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E 중복승인 캠페인'))
        .expect(200);
      const created = success<CampaignResponseDto>(createRes).data;

      const approveRes = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/approve`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: created.edit_count })
        .expect(200);
      const approved = success<CampaignResponseDto>(approveRes).data;

      const res = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/approve`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: approved.edit_count })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });

    it('OPERATOR가 승인완료된 캠페인을 수정하면 approval_status가 승인대기(2)로 자동 재전환된다', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send(createCampaignPayload('E2E 재승인 캠페인'))
        .expect(200);
      const created = success<CampaignResponseDto>(createRes).data;

      const approveRes = await request(app.getHttpServer())
        .post(`/campaigns/${created.coupon_campaign_id}/approve`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ edit_count: created.edit_count })
        .expect(200);
      const approved = success<CampaignResponseDto>(approveRes).data;
      expect(approved.approval_status).toBe(3);

      const updateRes = await request(app.getHttpServer())
        .patch(`/campaigns/${created.coupon_campaign_id}`)
        .set('Authorization', `Bearer ${opAccessToken}`)
        .send({
          edit_count: approved.edit_count,
          name: 'E2E 재승인 캠페인(수정됨)',
        })
        .expect(200);
      const updated = success<CampaignResponseDto>(updateRes).data;
      expect(updated.name).toBe('E2E 재승인 캠페인(수정됨)');
      expect(updated.approval_status).toBe(2); // OPERATOR 수정으로 승인대기로 되돌아감
    });
  });
});
