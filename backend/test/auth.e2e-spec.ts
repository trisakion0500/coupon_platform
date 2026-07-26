import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { RefreshResponseDto } from '../src/auth/dto/refresh-response.dto';
import { ResultCode } from '../src/common/response/result-code.enum';
import { UserResponseDto } from '../src/user/dto/user-response.dto';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * 09_AUTH_API.md 6개 엔드포인트(회원가입/로그인/로그아웃/재발급/내정보/비번변경) E2E — 백엔드
 * vertical-slice 검증 방식(공통 인프라부터 실제 DB까지 파이프라인 전체 확인)을 프론트 없이
 * HTTP 레벨에서 그대로 재현한 첫 도메인. 실제 로컬 DB를 쓰므로 `npm run test:e2e`의
 * Jest globalSetup(`global-setup.ts`)이 매번 리셋+재시딩한다.
 *
 * 로그인 rate limiter(기본 15분당 10회, `LOGIN_RATE_LIMIT_MAX`)가 signup/login 두 라우트를
 * 공유해서 카운트하므로, 이 파일 전체의 signup+login 호출 수를 9회로 제한해뒀다 — 테스트를
 * 추가할 때 이 예산을 넘기지 않도록 주의할 것(넘기면 마지막 호출이 200 대신 429로 실패한다).
 *
 * @author trisakion
 */
describe('Auth E2E (09_AUTH_API.md)', () => {
  let app: INestApplication;

  const testLoginId = 'e2e_user01';
  const testPassword = 'Passw0rd!23';
  const newTestPassword = 'NewPassw0rd!45';

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('회원가입 → 승인 → 로그인 → 재발급 → 내정보 → 비번변경 → 로그아웃', () => {
    let newUserId: number;
    let saAccessToken: string;
    let accessToken: string;
    let refreshToken: string;

    it('POST /auth/signup — 신규 회원가입은 승인대기(status=0)로 생성된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          company_id: 2,
          requested_project_id: 2,
          login_id: testLoginId,
          password: testPassword,
          user_name: 'E2E 테스트 사용자',
          email: 'e2e_user01@example.com',
          phone_number: '010-9999-9999',
        })
        .expect(200);

      const body = success<UserResponseDto>(res);
      expect(body.result).toBe(ResultCode.SUCCESS);
      expect(body.data.login_id).toBe(testLoginId);
      expect(body.data.status).toBe(0);
      newUserId = body.data.user_id;
      expect(newUserId).toBeGreaterThan(0);
    });

    it('POST /auth/login — 승인 전에는 SIGNUP_PENDING_APPROVAL(10005)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: testLoginId, password: testPassword })
        .expect(401);

      expect(failure(res).result).toBe(ResultCode.SIGNUP_PENDING_APPROVAL);
    });

    it('POST /auth/login(sa) → POST /users/:id/approve — SUPER_ADMIN이 승인하면 status가 1로 바뀐다', async () => {
      const saLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: 'sa', password: '1234' })
        .expect(200);
      saAccessToken = success<LoginResponseDto>(saLoginRes).data.access_token;

      const approveRes = await request(app.getHttpServer())
        .post(`/users/${newUserId}/approve`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      const body = success<UserResponseDto>(approveRes);
      expect(body.result).toBe(ResultCode.SUCCESS);
      expect(body.data.status).toBe(1);
    });

    it('POST /auth/login — 승인 후에는 로그인에 성공해 Access/Refresh Token을 발급한다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: testLoginId, password: testPassword })
        .expect(200);

      const body = success<LoginResponseDto>(res);
      expect(body.result).toBe(ResultCode.SUCCESS);
      expect(body.data.role_code).toBe(40); // 미배정 시 fail-safe 기본값(OPERATOR)
      accessToken = body.data.access_token;
      refreshToken = body.data.refresh_token;
    });

    it('GET /auth/me — 발급된 Access Token으로 본인 정보를 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const body = success<UserResponseDto>(res);
      expect(body.data.login_id).toBe(testLoginId);
      expect(body.data.phone_number).toBe('010-9999-9999'); // 복호화까지 왕복 확인
    });

    it('POST /auth/refresh — Refresh Token으로 재발급하면 새 Access Token이 유효하고 이전 토큰은 무효화된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200);

      const body = success<RefreshResponseDto>(res);
      expect(body.data.role_code).toBe(40);
      const rotatedAccessToken = body.data.access_token;
      expect(rotatedAccessToken).not.toBe(accessToken);

      // 세션당 jti가 1개로 회전되므로, 재발급 이후 이전 Access Token은 즉시 무효화된다.
      const staleRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(failure(staleRes).result).toBe(ResultCode.INVALID_SESSION);

      accessToken = rotatedAccessToken;

      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(success<UserResponseDto>(meRes).data.login_id).toBe(testLoginId);
    });

    it('PATCH /auth/password — 비밀번호 변경 후 예전 비밀번호로는 로그인이 실패하고 새 비밀번호로는 성공한다', async () => {
      await request(app.getHttpServer())
        .patch('/auth/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ current_password: testPassword, new_password: newTestPassword })
        .expect(200);

      const oldPwLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: testLoginId, password: testPassword })
        .expect(401);
      expect(failure(oldPwLoginRes).result).toBe(ResultCode.PASSWORD_MISMATCH);

      const newPwLoginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: testLoginId, password: newTestPassword })
        .expect(200);
      const body = success<LoginResponseDto>(newPwLoginRes);
      expect(body.result).toBe(ResultCode.SUCCESS);
      accessToken = body.data.access_token;
    });

    it('POST /auth/logout — 로그아웃 이후에는 같은 Access Token으로 인증이 거부된다', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.INVALID_SESSION);
    });
  });

  describe('로그인/회원가입 실패 케이스', () => {
    it('POST /auth/login — 존재하지 않는 login_id는 LOGIN_FAILED(10001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: 'no_such_user', password: 'whatever123' })
        .expect(401);
      expect(failure(res).result).toBe(ResultCode.LOGIN_FAILED);
    });

    it('POST /auth/signup — 존재하지 않는 company_id는 COMPANY_NOT_FOUND(31001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          company_id: 999999,
          login_id: 'e2e_ghost_company',
          password: testPassword,
          user_name: '유령 회사 가입',
          email: 'ghost@example.com',
          phone_number: '010-0000-0000',
        })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.COMPANY_NOT_FOUND);
    });

    it('POST /auth/signup — 필수 필드 누락은 ValidationPipe에 의해 400(INVALID_FIELD_FORMAT)으로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ company_id: 2 })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_FIELD_FORMAT);
    });
  });
});
