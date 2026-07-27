import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import type { PaginatedResult } from '../src/common/response/pagination';
import { ResultCode } from '../src/common/response/result-code.enum';
import {
  ApiSecretRotateResponseDto,
  ProjectCreateResponseDto,
  ProjectLookupResponseDto,
  ProjectResponseDto,
} from '../src/project/dto/project-response.dto';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * 13_PROJECT_API.md 6개 엔드포인트(코드조회/생성/목록/상세/수정/Secret재발급) E2E. 이 도메인의
 * 핵심은 2026-07-24에 두 단계로 확정된 **DEVELOPER 스코핑**(회사 소속이 아니라 실제 활성
 * `user_role` 배정 + 그 프로젝트에서 role_code<=20 여부)이라, 시드 계정만으로는 재현이 안 돼
 * 새 프로젝트를 만들어 `dev`(DEV_PROJECT에만 배정됨)가 그 프로젝트를 못 보는 것까지 직접
 * 검증한다. `PATCH`/Secret 재발급의 `edit_count` 낙관적 락(충돌 시 30005)도 함께 검증한다.
 *
 * @author trisakion
 */
describe('Project E2E (13_PROJECT_API.md)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let devAccessToken: string;
  let mgrAccessToken: string;

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

  describe('GET /projects/lookup — 인증 불필요, 회원가입 화면 전용', () => {
    it('존재하는 (company_id, project_code)는 프로젝트명을 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/lookup')
        .query({ company_id: 2, project_code: 'DEV_PROJECT' })
        .expect(200);

      const body = success<ProjectLookupResponseDto>(res);
      expect(body.data.project_id).toBe(2);
      expect(body.data.project_name).toBe('Developer Company Default Project');
    });

    it('존재하지 않는 조합은 PROJECT_NOT_FOUND(31002)', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/lookup')
        .query({ company_id: 2, project_code: 'NO_SUCH_PROJECT' })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.PROJECT_NOT_FOUND);
    });
  });

  describe('POST /projects — 생성(SUPER_ADMIN 전용)', () => {
    let createdProjectId: number;

    it('SUPER_ADMIN은 새 프로젝트를 생성하고 평문 API Secret을 1회 받는다', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({
          company_id: 2,
          project_code: 'E2E_PROJ',
          project_name: 'E2E 테스트 프로젝트',
        })
        .expect(200);

      const body = success<ProjectCreateResponseDto>(res);
      expect(body.data.project_code).toBe('E2E_PROJ');
      expect(body.data.edit_count).toBe(0);
      expect(typeof body.data.api_secret).toBe('string');
      expect(body.data.api_secret.length).toBeGreaterThan(0);
      createdProjectId = body.data.project_id;
      expect(createdProjectId).toBeGreaterThan(0);
    });

    it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다(생성은 SUPER_ADMIN 전용)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${devAccessToken}`)
        .send({
          company_id: 2,
          project_code: 'SHOULD_FAIL',
          project_name: '거부되어야 함',
        })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('같은 회사 내 중복 project_code는 DUPLICATE_DATA(32001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({
          company_id: 2,
          project_code: 'E2E_PROJ',
          project_name: '중복 코드',
        })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });

    it('존재하지 않는 company_id는 COMPANY_NOT_FOUND(31001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({
          company_id: 999999,
          project_code: 'GHOST',
          project_name: '유령 회사 프로젝트',
        })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.COMPANY_NOT_FOUND);
    });

    describe('DEVELOPER 스코핑 — 방금 만든 프로젝트에는 dev가 배정되지 않았다', () => {
      it('GET /projects — SUPER_ADMIN은 새 프로젝트를 포함한 전체를 본다', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .query({ company_id: 2 })
          .set('Authorization', `Bearer ${saAccessToken}`)
          .expect(200);

        const body = success<PaginatedResult<ProjectResponseDto>>(res);
        const codes = body.data.items.map((p) => p.project_code);
        expect(codes).toEqual(
          expect.arrayContaining(['DEV_PROJECT', 'E2E_PROJ']),
        );
      });

      it('GET /projects — DEVELOPER(dev)는 배정된 DEV_PROJECT만 보고 새 프로젝트는 안 보인다', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${devAccessToken}`)
          .expect(200);

        const body = success<PaginatedResult<ProjectResponseDto>>(res);
        const codes = body.data.items.map((p) => p.project_code);
        expect(codes).toEqual(['DEV_PROJECT']);
      });

      it('GET /projects — MANAGER는 PERMISSION_DENIED(20001)로 거부된다(목록은 SUPER_ADMIN/DEVELOPER만)', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', `Bearer ${mgrAccessToken}`)
          .expect(403);
        expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
      });

      it('GET /projects/:id — DEVELOPER(dev)는 배정 안 된 새 프로젝트 상세조회 시 PERMISSION_DENIED(20001)', async () => {
        const res = await request(app.getHttpServer())
          .get(`/projects/${createdProjectId}`)
          .set('Authorization', `Bearer ${devAccessToken}`)
          .expect(403);
        expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
      });

      it('GET /projects/:id — DEVELOPER(dev)는 배정된 DEV_PROJECT(id=2)는 정상 조회한다', async () => {
        const res = await request(app.getHttpServer())
          .get('/projects/2')
          .set('Authorization', `Bearer ${devAccessToken}`)
          .expect(200);
        expect(success<ProjectResponseDto>(res).data.project_code).toBe(
          'DEV_PROJECT',
        );
      });
    });

    describe('PATCH /projects/:id — 수정(SUPER_ADMIN 전용) + edit_count 낙관적 락', () => {
      it('SUPER_ADMIN은 올바른 edit_count로 수정하면 edit_count가 증가한다', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/projects/${createdProjectId}`)
          .set('Authorization', `Bearer ${saAccessToken}`)
          .send({ edit_count: 0, project_name: 'E2E 프로젝트(수정됨)' })
          .expect(200);

        const body = success<ProjectResponseDto>(res);
        expect(body.data.project_name).toBe('E2E 프로젝트(수정됨)');
        expect(body.data.edit_count).toBe(1);
      });

      it('오래된 edit_count로 재수정하면 UPDATE_CONFLICT(30005)', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/projects/${createdProjectId}`)
          .set('Authorization', `Bearer ${saAccessToken}`)
          .send({ edit_count: 0, project_name: '충돌해야 함' }) // 이미 1로 증가했으므로 stale
          .expect(400);
        expect(failure(res).result).toBe(ResultCode.UPDATE_CONFLICT);
      });

      it('DEVELOPER는 PERMISSION_DENIED(20001)로 거부된다(수정은 SUPER_ADMIN 전용)', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/projects/${createdProjectId}`)
          .set('Authorization', `Bearer ${devAccessToken}`)
          .send({ edit_count: 1, project_name: '거부되어야 함' })
          .expect(403);
        expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
      });

      it('존재하지 않는 ID는 PROJECT_NOT_FOUND(31002)', async () => {
        const res = await request(app.getHttpServer())
          .patch('/projects/999999')
          .set('Authorization', `Bearer ${saAccessToken}`)
          .send({ edit_count: 0, project_name: '유령 프로젝트' })
          .expect(404);
        expect(failure(res).result).toBe(ResultCode.PROJECT_NOT_FOUND);
      });
    });

    describe('POST /projects/:id/api-secret/rotate — Secret 재발급(SUPER_ADMIN/DEVELOPER) + edit_count 낙관적 락', () => {
      it('DEVELOPER(dev)는 배정된 DEV_PROJECT(id=2)의 Secret을 재발급할 수 있다', async () => {
        const getRes = await request(app.getHttpServer())
          .get('/projects/2')
          .set('Authorization', `Bearer ${devAccessToken}`)
          .expect(200);
        const currentEditCount =
          success<ProjectResponseDto>(getRes).data.edit_count;

        const rotateRes = await request(app.getHttpServer())
          .post('/projects/2/api-secret/rotate')
          .set('Authorization', `Bearer ${devAccessToken}`)
          .send({ edit_count: currentEditCount })
          .expect(200);

        const body = success<ApiSecretRotateResponseDto>(rotateRes);
        expect(body.data.project_id).toBe(2);
        expect(body.data.edit_count).toBe(currentEditCount + 1);
        expect(typeof body.data.api_secret).toBe('string');
      });

      it('DEVELOPER(dev)는 배정 안 된 새 프로젝트의 Secret 재발급 시 PERMISSION_DENIED(20001)', async () => {
        const res = await request(app.getHttpServer())
          .post(`/projects/${createdProjectId}/api-secret/rotate`)
          .set('Authorization', `Bearer ${devAccessToken}`)
          .send({ edit_count: 1 })
          .expect(403);
        expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
      });

      it('오래된 edit_count로 재발급하면 UPDATE_CONFLICT(30005)', async () => {
        const res = await request(app.getHttpServer())
          .post('/projects/2/api-secret/rotate')
          .set('Authorization', `Bearer ${devAccessToken}`)
          .send({ edit_count: 0 }) // 이미 회전했으므로 stale
          .expect(400);
        expect(failure(res).result).toBe(ResultCode.UPDATE_CONFLICT);
      });

      it('존재하지 않는 ID는 PROJECT_NOT_FOUND(31002)', async () => {
        const res = await request(app.getHttpServer())
          .post('/projects/999999/api-secret/rotate')
          .set('Authorization', `Bearer ${saAccessToken}`)
          .send({ edit_count: 0 })
          .expect(404);
        expect(failure(res).result).toBe(ResultCode.PROJECT_NOT_FOUND);
      });
    });
  });
});
