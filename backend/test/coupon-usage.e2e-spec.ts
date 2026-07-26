import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { CampaignResponseDto } from '../src/campaign/dto/campaign-response.dto';
import { IssueCodesResultDto } from '../src/campaign/dto/code-response.dto';
import { ResultCode } from '../src/common/response/result-code.enum';
import {
  ConfirmResultDto,
  ReserveResultDto,
  UnconfirmedItemDto,
} from '../src/coupon-usage/dto/coupon-usage-response.dto';
import { ProjectCreateResponseDto } from '../src/project/dto/project-response.dto';
import { failure, success } from './utils/envelope';
import type { S2sCredentials } from './utils/s2s';
import { buildS2sHeaders } from './utils/s2s';
import { createE2eApp } from './utils/test-app';

/**
 * 18_COUPON_USAGE_API.md 2장(Reserve/Confirm)+3장(미컨슘 조회) E2E — 이 프로젝트 E2E에서 처음
 * 다루는 S2S(API Key+HMAC-SHA256) 인증 도메인. 관리 콘솔(JWT) 도메인과 인증 방식 자체가 달라,
 * `test/utils/s2s.ts`의 `buildS2sHeaders`가 `S2sAuthGuard`와 동일한 규칙으로 서명을 계산한다.
 *
 * 시드 프로젝트(1/2)의 `api_secret`은 특정 ENCRYPTION_KEY로 고정 커밋할 수 없는 플레이스홀더라
 * 로컬 `.env`의 실제 키로 복호화되지 않는다(docs/19_DEV_SETUP.md 4.2.1과 동일한 이유) — 그래서
 * S2S 테스트는 관리 콘솔 API로 새 프로젝트를 직접 만들어 실제로 복호화 가능한 API Key/Secret
 * 쌍을 얻는다(`ProjectService.create`가 실제 `CryptoService`로 암호화하므로 문제없다).
 *
 * @author trisakion
 */
describe('Coupon Usage S2S E2E (18_COUPON_USAGE_API.md 2/3장)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let creds: S2sCredentials;

  /** FIXED, use_limit_per_user=1 — 멱등 재시도 + 다중유저 독립사용 검증용. */
  let codeA: string;
  /** FIXED, use_limit_per_user=2 — 유저별 사용한도 초과(33003) 검증용. */
  let codeB: string;
  /** FIXED, 캠페인 미활성화 — CAMPAIGN_NOT_USABLE(33002) 검증용. */
  let codeC: string;

  beforeAll(async () => {
    app = await createE2eApp();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login_id: 'sa', password: '1234' })
      .expect(200);
    saAccessToken = success<LoginResponseDto>(loginRes).data.access_token;

    const projectRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        company_id: 2,
        project_code: 'E2E_S2S_PROJ',
        project_name: 'E2E S2S 테스트 프로젝트',
      })
      .expect(200);
    const project = success<ProjectCreateResponseDto>(projectRes).data;
    creds = { apiKey: project.api_key, apiSecret: project.api_secret };

    codeA = await setupActivatedFixedCampaign(project.project_id, 'A', 1);
    codeB = await setupActivatedFixedCampaign(project.project_id, 'B', 2);
    codeC = await setupInactiveFixedCampaign(project.project_id, 'C');
  });

  afterAll(async () => {
    await app.close();
  });

  /** SUPER_ADMIN으로 FIXED 캠페인을 만들고 코드를 발급한 뒤 usable_qty를 열고 활성화까지 끝낸다. */
  const setupActivatedFixedCampaign = async (
    projectId: number,
    suffix: string,
    useLimitPerUser: number,
  ): Promise<string> => {
    const createRes = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        project_id: projectId,
        name: `E2E S2S 캠페인 ${suffix}`,
        campaign_start: '2020-01-01 00:00:00', // 현재 시각이 반드시 기간 내여야 reserve가 성공한다
        campaign_end: '2030-01-01 00:00:00',
        code_type: 2, // FIXED
        requested_qty: 10,
        use_limit_per_user: useLimitPerUser,
        reward_data: { item_id: 1001, item_amount: 100 },
      })
      .expect(200);
    const campaign = success<CampaignResponseDto>(createRes).data;

    const codeValue = `E2E_S2S_CODE_${suffix}`;
    const issueRes = await request(app.getHttpServer())
      .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ code_value: codeValue })
      .expect(200);
    const issued = success<IssueCodesResultDto>(issueRes).data;

    const patchRes = await request(app.getHttpServer())
      .patch(`/campaigns/${campaign.coupon_campaign_id}`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        edit_count: campaign.edit_count,
        usable_qty: issued.generated_qty,
      })
      .expect(200);
    const patched = success<CampaignResponseDto>(patchRes).data;

    await request(app.getHttpServer())
      .post(`/campaigns/${campaign.coupon_campaign_id}/status`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ edit_count: patched.edit_count, status: 2 })
      .expect(200);

    return codeValue;
  };

  /** 코드는 발급하지만 캠페인은 대기(status=1) 상태로 남겨둔다 — CAMPAIGN_NOT_USABLE 재현용. */
  const setupInactiveFixedCampaign = async (
    projectId: number,
    suffix: string,
  ): Promise<string> => {
    const createRes = await request(app.getHttpServer())
      .post('/campaigns')
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({
        project_id: projectId,
        name: `E2E S2S 미활성 캠페인 ${suffix}`,
        campaign_start: '2020-01-01 00:00:00',
        campaign_end: '2030-01-01 00:00:00',
        code_type: 2,
        requested_qty: 1,
        reward_data: { item_id: 1001, item_amount: 100 },
      })
      .expect(200);
    const campaign = success<CampaignResponseDto>(createRes).data;

    const codeValue = `E2E_S2S_CODE_${suffix}`;
    await request(app.getHttpServer())
      .post(`/campaigns/${campaign.coupon_campaign_id}/codes`)
      .set('Authorization', `Bearer ${saAccessToken}`)
      .send({ code_value: codeValue })
      .expect(200);

    return codeValue;
  };

  /** S2S 서명 헤더를 계산해 POST 요청을 보낸다. */
  const s2sPost = (path: string, body: Record<string, unknown>) => {
    const bodyString = JSON.stringify(body);
    const headers = buildS2sHeaders(creds, 'POST', path, '', bodyString);
    return request(app.getHttpServer()).post(path).set(headers).send(body);
  };

  /** S2S 서명 헤더를 계산해 GET 요청을 보낸다(쿼리스트링은 호출부가 직접 조립한다). */
  const s2sGet = (path: string, rawQuery: string) => {
    const headers = buildS2sHeaders(creds, 'GET', path, rawQuery, '');
    const url = rawQuery ? `${path}?${rawQuery}` : path;
    return request(app.getHttpServer()).get(url).set(headers);
  };

  describe('POST /v1/coupons/:code/reserve → confirm → 미컨슘 조회', () => {
    it('reserve 성공 후 미컨슘 목록에 나타나고, confirm 후에는 사라진다', async () => {
      const reserveRes = await s2sPost(`/v1/coupons/${codeA}/reserve`, {
        game_user_id: 'e2e_player_A1',
      }).expect(200);
      const reserved = success<ReserveResultDto>(reserveRes).data;
      expect(reserved.code_value).toBe(codeA);
      expect(reserved.reward_data).toEqual({ item_id: 1001, item_amount: 100 });

      const unconfirmedRes = await s2sGet(
        '/v1/coupons/unconfirmed',
        'game_user_id=e2e_player_A1',
      ).expect(200);
      const unconfirmedBody = success<{ items: UnconfirmedItemDto[] }>(
        unconfirmedRes,
      );
      expect(
        unconfirmedBody.data.items.some((i) => i.code_value === codeA),
      ).toBe(true);

      const confirmRes = await s2sPost(`/v1/coupons/${codeA}/confirm`, {
        game_user_id: 'e2e_player_A1',
      }).expect(200);
      const confirmed = success<ConfirmResultDto>(confirmRes).data;
      expect(confirmed.coupon_code_usage_id).toBe(
        reserved.coupon_code_usage_id,
      );

      const afterConfirmRes = await s2sGet(
        '/v1/coupons/unconfirmed',
        'game_user_id=e2e_player_A1',
      ).expect(200);
      expect(
        success<{ items: UnconfirmedItemDto[] }>(afterConfirmRes).data.items,
      ).toEqual([]);
    });

    it('use_limit_per_user=1인 코드를 같은 유저가 재시도하면 동일한 사용이력을 멱등하게 반환한다', async () => {
      const first = await s2sPost(`/v1/coupons/${codeA}/reserve`, {
        game_user_id: 'e2e_player_A2',
      }).expect(200);
      const second = await s2sPost(`/v1/coupons/${codeA}/reserve`, {
        game_user_id: 'e2e_player_A2',
      }).expect(200);

      expect(success<ReserveResultDto>(second).data.coupon_code_usage_id).toBe(
        success<ReserveResultDto>(first).data.coupon_code_usage_id,
      );
    });

    it('FIXED 코드는 서로 다른 유저가 각자 독립적으로 reserve할 수 있다(다중유저 공유 코드)', async () => {
      const userXRes = await s2sPost(`/v1/coupons/${codeA}/reserve`, {
        game_user_id: 'e2e_player_A3',
      }).expect(200);
      const userYRes = await s2sPost(`/v1/coupons/${codeA}/reserve`, {
        game_user_id: 'e2e_player_A4',
      }).expect(200);

      expect(
        success<ReserveResultDto>(userYRes).data.coupon_code_usage_id,
      ).not.toBe(success<ReserveResultDto>(userXRes).data.coupon_code_usage_id);
    });

    it('use_limit_per_user=2인 코드는 같은 유저가 2번까지만 성공하고 3번째는 USER_USE_LIMIT_EXCEEDED(33003)', async () => {
      await s2sPost(`/v1/coupons/${codeB}/reserve`, {
        game_user_id: 'e2e_player_B1',
      }).expect(200);
      await s2sPost(`/v1/coupons/${codeB}/reserve`, {
        game_user_id: 'e2e_player_B1',
      }).expect(200);

      const res = await s2sPost(`/v1/coupons/${codeB}/reserve`, {
        game_user_id: 'e2e_player_B1',
      }).expect(400);
      expect(failure(res).result).toBe(ResultCode.USER_USE_LIMIT_EXCEEDED);
    });

    it('캠페인이 활성화되지 않았으면 CAMPAIGN_NOT_USABLE(33002)', async () => {
      const res = await s2sPost(`/v1/coupons/${codeC}/reserve`, {
        game_user_id: 'e2e_player_C1',
      }).expect(400);
      expect(failure(res).result).toBe(ResultCode.CAMPAIGN_NOT_USABLE);
    });

    it('존재하지 않는 코드는 COUPON_CODE_NOT_FOUND(31005)', async () => {
      const res = await s2sPost('/v1/coupons/NO_SUCH_CODE/reserve', {
        game_user_id: 'e2e_player_ghost',
      }).expect(404);
      expect(failure(res).result).toBe(ResultCode.COUPON_CODE_NOT_FOUND);
    });

    it('reserve 이력이 없는데 confirm하면 USAGE_NOT_FOUND(31006)', async () => {
      const res = await s2sPost(`/v1/coupons/${codeA}/confirm`, {
        game_user_id: 'e2e_player_never_reserved',
      }).expect(404);
      expect(failure(res).result).toBe(ResultCode.USAGE_NOT_FOUND);
    });
  });

  describe('S2S 인증 실패 케이스', () => {
    it('인증 헤더가 없으면 S2S_MISSING_AUTH_HEADER(10012)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/coupons/${codeA}/reserve`)
        .send({ game_user_id: 'e2e_player_noauth' })
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.S2S_MISSING_AUTH_HEADER);
    });

    it('서명이 일치하지 않으면 S2S_SIGNATURE_MISMATCH(10011)', async () => {
      const path = `/v1/coupons/${codeA}/reserve`;
      const body = { game_user_id: 'e2e_player_badsig' };
      const headers = buildS2sHeaders(
        creds,
        'POST',
        path,
        '',
        JSON.stringify(body),
      );
      headers['X-API-Signature'] = '0'.repeat(64); // 형식은 맞지만 실제로는 틀린 서명

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.S2S_SIGNATURE_MISMATCH);
    });

    it('존재하지 않는 API Key는 S2S_INVALID_API_KEY(10010)', async () => {
      const badCreds: S2sCredentials = {
        apiKey: 'no-such-api-key',
        apiSecret: creds.apiSecret,
      };
      const path = `/v1/coupons/${codeA}/reserve`;
      const body = { game_user_id: 'e2e_player_badkey' };
      const headers = buildS2sHeaders(
        badCreds,
        'POST',
        path,
        '',
        JSON.stringify(body),
      );

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.S2S_INVALID_API_KEY);
    });

    it('동일한 (timestamp,nonce,signature)로 같은 요청을 재전송하면 S2S_NONCE_REUSED(10015)', async () => {
      const path = `/v1/coupons/${codeA}/reserve`;
      const body = { game_user_id: 'e2e_player_replay' };
      const bodyString = JSON.stringify(body);
      const headers = buildS2sHeaders(creds, 'POST', path, '', bodyString);

      await request(app.getHttpServer())
        .post(path)
        .set(headers)
        .send(body)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(path)
        .set(headers) // timestamp/nonce/signature 그대로 재사용 — 재전송 시도
        .send(body)
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.S2S_NONCE_REUSED);
    });
  });
});
