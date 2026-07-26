import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { CampaignResponseDto } from '../src/campaign/dto/campaign-response.dto';
import { IssueCodesResultDto } from '../src/campaign/dto/code-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import { CouponUseLogItemDto } from '../src/coupon-use-log/dto/coupon-use-log-response.dto';
import { ProjectCreateResponseDto } from '../src/project/dto/project-response.dto';
import { failure, success } from './utils/envelope';
import type { S2sCredentials } from './utils/s2s';
import { buildS2sHeaders } from './utils/s2s';
import { createE2eApp } from './utils/test-app';

/**
 * 17_CAMPAIGN_API.md 4.3(`GET /coupon-use-logs`) E2E — S2S reserve/confirm 시도(성공+실패)를
 * 먼저 몇 건 만들어두고, 관리 콘솔(JWT)로 그 로그를 조회·필터링하는 시나리오. 로그 DB
 * (`log_coupon_use`)가 메인 DB의 `user_role`을 참조 못해 "메인 DB 접근권한 확인
 * (`SP_PROJECT_CHECK_ACCESS`) → 통과 시에만 로그 DB 조회" 2단계 패턴을 쓰는 게 이 API의 핵심이라,
 * 그 권한 스코핑(프로젝트에 배정 없는 사용자는 20001)을 직접 검증한다.
 *
 * @author trisakion
 */
describe('Coupon Use Log E2E (17_CAMPAIGN_API.md 4.3)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let mgrAccessToken: string;
  let projectId: number;
  let campaignId: number;
  let creds: S2sCredentials;

  const codeValue = 'E2E_LOG_CODE';

  beforeAll(async () => {
    app = await createE2eApp();

    const login = async (loginId: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: loginId, password: '1234' })
        .expect(200);
      return success<LoginResponseDto>(res).data.access_token;
    };
    saAccessToken = await login('sa');
    mgrAccessToken = await login('mgr'); // DEV_PROJECT(project_id=2)에만 배정됨 — 이 프로젝트엔 미배정

    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        company_id: 2,
        project_code: 'E2E_LOG_PROJ',
        project_name: 'E2E 사용로그 테스트 프로젝트',
      })
      .expect(200);
    const project = success<ProjectCreateResponseDto>(projectRes).data;
    projectId = project.project_id;
    creds = { apiKey: project.api_key, apiSecret: project.api_secret };

    const createRes = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        project_id: projectId,
        name: 'E2E 사용로그 캠페인',
        campaign_start: '2020-01-01 00:00:00',
        campaign_end: '2030-01-01 00:00:00',
        code_type: 2, // FIXED
        requested_qty: 10,
        use_limit_per_user: 1,
        reward_data: { item_id: 1001, item_amount: 100 },
      })
      .expect(200);
    const campaign = success<CampaignResponseDto>(createRes).data;
    campaignId = campaign.coupon_campaign_id;

    const issueRes = await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/codes`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ code_value: codeValue })
      .expect(200);
    const issued = success<IssueCodesResultDto>(issueRes).data;

    const patchRes = await request(app.getHttpServer())
      .patch(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        edit_count: campaign.edit_count,
        usable_qty: issued.generated_qty,
      })
      .expect(200);
    const patched = success<CampaignResponseDto>(patchRes).data;

    await request(app.getHttpServer())
      .post(`/campaigns/${campaignId}/status`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ edit_count: patched.edit_count, status: 2 })
      .expect(200);

    // 로그 4건 적재: RESERVE 성공(action=10,result_type=0), CONFIRM 성공(action=20,result_type=0),
    // RESERVE 실패-코드없음(action=10,result_type=10), CONFIRM 실패-소모기록없음(action=20,result_type=50)
    await s2sPost(`/v1/coupons/${codeValue}/reserve`, {
      game_user_id: 'e2e_log_player1',
    }).expect(200);
    await s2sPost(`/v1/coupons/${codeValue}/confirm`, {
      game_user_id: 'e2e_log_player1',
    }).expect(200);
    await s2sPost('/v1/coupons/NO_SUCH_LOG_CODE/reserve', {
      game_user_id: 'e2e_log_player2',
    }).expect(404);
    await s2sPost(`/v1/coupons/${codeValue}/confirm`, {
      game_user_id: 'e2e_log_player_never_reserved',
    }).expect(404);
  });

  afterAll(async () => {
    await app.close();
  });

  function s2sPost(path: string, body: Record<string, unknown>) {
    const headers = buildS2sHeaders(
      creds,
      'POST',
      path,
      '',
      JSON.stringify(body),
    );
    return request(app.getHttpServer()).post(path).set(headers).send(body);
  }

  it('SUPER_ADMIN은 project_id로 스코핑된 사용로그 전체를 조회할 수 있다', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId })
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);

    const body = success<PaginatedResult<CouponUseLogItemDto>>(res);
    expect(body.data.total_count).toBe(4);

    const reserveSuccess = body.data.items.find(
      (l) => l.action === 10 && l.result_type === 0,
    );
    expect(reserveSuccess?.campaign_name).toBe('E2E 사용로그 캠페인');
    expect(reserveSuccess?.coupon_campaign_id).toBe(campaignId);

    const reserveNotFound = body.data.items.find(
      (l) => l.action === 10 && l.result_type === 10,
    );
    expect(reserveNotFound?.coupon_campaign_id).toBeNull();
    expect(reserveNotFound?.campaign_name).toBeNull(); // 코드 자체가 없던 시도라 캠페인을 특정 못함

    const confirmSuccess = body.data.items.find(
      (l) => l.action === 20 && l.result_type === 0,
    );
    expect(confirmSuccess).toBeDefined();

    const confirmNotFound = body.data.items.find(
      (l) => l.action === 20 && l.result_type === 50,
    );
    expect(confirmNotFound).toBeDefined();
  });

  it('action 필터를 주면 RESERVE(10) 2건만 반환한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId, action: 10 })
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
    const body = success<PaginatedResult<CouponUseLogItemDto>>(res);
    expect(body.data.total_count).toBe(2);
    expect(body.data.items.every((l) => l.action === 10)).toBe(true);
  });

  it('result_type 필터를 주면 성공(0) 2건만 반환한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId, result_type: 0 })
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
    const body = success<PaginatedResult<CouponUseLogItemDto>>(res);
    expect(body.data.total_count).toBe(2);
    expect(body.data.items.every((l) => l.result_type === 0)).toBe(true);
  });

  it('game_user_id 필터를 주면 해당 유저의 로그만 반환한다', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId, game_user_id: 'e2e_log_player1' })
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
    const body = success<PaginatedResult<CouponUseLogItemDto>>(res);
    expect(body.data.total_count).toBe(2); // reserve + confirm
    expect(
      body.data.items.every((l) => l.game_user_id === 'e2e_log_player1'),
    ).toBe(true);
  });

  it('code_value 필터를 주면 존재하지 않는 코드 시도는 제외된다', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId, code_value: codeValue })
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(200);
    const body = success<PaginatedResult<CouponUseLogItemDto>>(res);
    expect(body.data.total_count).toBe(3); // NO_SUCH_LOG_CODE 시도 1건 제외
    expect(body.data.items.every((l) => l.code_value === codeValue)).toBe(true);
  });

  it('DEVELOPER/MANAGER 등 이 프로젝트에 배정 없는 사용자는 PERMISSION_DENIED(20001)', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .query({ project_id: projectId })
      .set('Authorization', `Bearer ${mgrAccessToken}`)
      .expect(403);
    expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
  });

  it('project_id 없이 조회하면 REQUIRED_FIELD_MISSING(30001)', async () => {
    const res = await request(app.getHttpServer())
      .get('/coupon-use-logs')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .expect(400);
    expect(failure(res).result).toBe(ResultCode.REQUIRED_FIELD_MISSING);
  });
});
