import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import { UserResponseDto } from '../src/user/dto/user-response.dto';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * 14_USER_API.md 1장(User) 7개 엔드포인트(목록/상세/승인/반려/수정/비번초기화) E2E. 목록/상세는
 * SUPER_ADMIN+DEVELOPER(DEVELOPER는 회사 단위로 강제 스코핑), 나머지는 SUPER_ADMIN 전용이다.
 * 승인/반려/수정 대상은 시드 계정을 건드리지 않기 위해 매번 `POST /auth/signup`으로 새 pending
 * 사용자를 만들어 쓰되, **권한거부 테스트는 `RolesGuard`가 SP 호출 전에 막아 대상의 실제 상태와
 * 무관**하다는 점을 이용해 기존 시드 계정(`op`, user_id=4)을 재사용한다 — 로그인 rate
 * limiter(signup+login 공유, 기본 15분당 10회)를 아끼기 위한 설계다.
 *
 * @author trisakion
 */
describe('User E2E (14_USER_API.md 1장)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let devAccessToken: string;
  let mgrAccessToken: string;
  /** 승인 describe에서 만든 사용자를 반려 describe의 "이미 승인된 사용자 반려 시도" 테스트가
   * 재사용한다(signup 예산 절약 — 파일 헤더 주석 참고). */
  let approvedUserId: number;

  /** 가드 단계에서 거부되는 테스트 전용 — 대상 사용자가 실제로 존재하기만 하면 무엇이든 상관없다. */
  const ANY_EXISTING_USER_ID = 4; // op 계정

  const signupPendingUser = async (loginId: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        company_id: 2,
        login_id: loginId,
        password: 'Passw0rd!23',
        user_name: `${loginId} 사용자`,
        email: `${loginId}@example.com`,
        phone_number: '010-1111-2222',
      })
      .expect(200);
    return success<UserResponseDto>(res).data.user_id;
  };

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
    devAccessToken = await login('dev');
    mgrAccessToken = await login('mgr');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users — 목록(SUPER_ADMIN+DEVELOPER, DEVELOPER는 회사 단위 강제 스코핑)', () => {
    it('SUPER_ADMIN은 company_id 필터로 특정 회사만 볼 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .query({ company_id: 1 })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      const body = success<PaginatedResult<UserResponseDto>>(res);
      expect(body.data.items.map((u) => u.login_id)).toEqual(['sa']);
    });

    it('DEVELOPER(dev)는 company_id 필터를 줘도 본인 소속 회사(2)로 강제 고정된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .query({ company_id: 1 }) // 무시되고 본인 회사(2)로 강제됨
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);

      const body = success<PaginatedResult<UserResponseDto>>(res);
      const loginIds = body.data.items.map((u) => u.login_id).sort();
      expect(loginIds).toEqual(expect.arrayContaining(['dev', 'mgr', 'op']));
      expect(loginIds).not.toContain('sa');
    });

    it('MANAGER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });
  });

  describe('GET /users/:id — 상세(SUPER_ADMIN+DEVELOPER, DEVELOPER는 타사 조회 시 거부)', () => {
    it('SUPER_ADMIN은 어느 회사 사용자든 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/3') // mgr, company_id=2
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      expect(success<UserResponseDto>(res).data.login_id).toBe('mgr');
    });

    it('DEVELOPER(dev)는 본인 소속 회사 사용자는 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/3') // mgr, company_id=2 (dev와 동일 회사)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(200);
      expect(success<UserResponseDto>(res).data.login_id).toBe('mgr');
    });

    it('DEVELOPER(dev)는 타 회사 사용자 조회 시 PERMISSION_DENIED(20001)', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/1') // sa, company_id=1
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('존재하지 않는 ID는 USER_NOT_FOUND(31003)', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/999999')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_NOT_FOUND);
    });
  });

  describe('POST /users/:id/approve — 가입승인(SUPER_ADMIN 전용, status 0→1)', () => {
    it('SUPER_ADMIN은 승인대기 사용자를 승인할 수 있다', async () => {
      approvedUserId = await signupPendingUser('e2e_approve_target'); // 반려 describe에서도 재사용

      const res = await request(app.getHttpServer())
        .post(`/users/${approvedUserId}/approve`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      expect(success<UserResponseDto>(res).data.status).toBe(1);
    });

    it('이미 승인된 사용자를 다시 승인하면 INVALID_STATE_TRANSITION(30004)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${approvedUserId}/approve`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${ANY_EXISTING_USER_ID}/approve`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('존재하지 않는 ID는 USER_NOT_FOUND(31003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/999999/approve')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_NOT_FOUND);
    });
  });

  describe('POST /users/:id/reject — 가입반려(SUPER_ADMIN 전용, status 0→2)', () => {
    it('SUPER_ADMIN은 승인대기 사용자를 반려할 수 있다', async () => {
      const pendingUserId = await signupPendingUser('e2e_reject_target');

      const res = await request(app.getHttpServer())
        .post(`/users/${pendingUserId}/reject`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      expect(success<UserResponseDto>(res).data.status).toBe(2);
    });

    it('이미 승인된 사용자(status=1)를 반려하면 INVALID_STATE_TRANSITION(30004)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${approvedUserId}/reject`) // 앞선 승인 describe에서 만든 사용자 재사용
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.INVALID_STATE_TRANSITION);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${ANY_EXISTING_USER_ID}/reject`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });
  });

  describe('PATCH /users/:id — 수정(SUPER_ADMIN 전용)', () => {
    let targetUserId: number;

    it('SUPER_ADMIN은 이름/이메일/휴대폰번호를 수정할 수 있다(phone_number 암복호화 왕복 확인)', async () => {
      targetUserId = await signupPendingUser('e2e_update_target');

      const res = await request(app.getHttpServer())
        .patch(`/users/${targetUserId}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({
          user_name: '수정된 이름',
          phone_number: '010-9999-0000',
          department: '개발팀',
        })
        .expect(200);

      const body = success<UserResponseDto>(res);
      expect(body.data.user_name).toBe('수정된 이름');
      expect(body.data.phone_number).toBe('010-9999-0000');
      expect(body.data.department).toBe('개발팀');
    });

    it('이미 사용 중인 이메일로 변경하면 DUPLICATE_DATA(32001)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${targetUserId}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ email: 'mgr@example.com' }) // 시드 계정 mgr의 이메일
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${targetUserId}`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .send({ user_name: '거부되어야 함' })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('존재하지 않는 ID는 USER_NOT_FOUND(31003)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/users/999999')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ user_name: '유령 사용자' })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_NOT_FOUND);
    });
  });

  describe('POST /users/:id/reset-password — 비밀번호 강제초기화(SUPER_ADMIN 전용)', () => {
    it('SUPER_ADMIN이 초기화하면 새 비밀번호로 로그인되고 예전 비밀번호는 실패한다', async () => {
      const userId = await signupPendingUser('e2e_reset_pw_target');
      await request(app.getHttpServer())
        .post(`/users/${userId}/approve`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/users/${userId}/reset-password`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ new_password: 'ResetPassw0rd!9' })
        .expect(200);

      const oldPwRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: 'e2e_reset_pw_target', password: 'Passw0rd!23' })
        .expect(401);
      expect(failure(oldPwRes).result).toBe(ResultCode.PASSWORD_MISMATCH);

      const newPwRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ login_id: 'e2e_reset_pw_target', password: 'ResetPassw0rd!9' })
        .expect(200);
      expect(success<LoginResponseDto>(newPwRes).result).toBe(
        ResultCode.SUCCESS,
      );
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post(`/users/${ANY_EXISTING_USER_ID}/reset-password`)
        .set('Authorization', `Bearer ${devAccessToken}`)
        .send({ new_password: 'ResetPassw0rd!9' })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('존재하지 않는 ID는 USER_NOT_FOUND(31003)', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/999999/reset-password')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ new_password: 'ResetPassw0rd!9' })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.USER_NOT_FOUND);
    });
  });
});
