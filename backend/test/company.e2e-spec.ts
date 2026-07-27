import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ActiveHeaderDataDto } from '../src/company/dto/active-header-data.dto';
import {
  CompanyLookupResponseDto,
  CompanyResponseDto,
} from '../src/company/dto/company-response.dto';
import { LoginResponseDto } from '../src/auth/dto/login-response.dto';
import { ResultCode } from '../src/common/response/result-code.enum';
import type { PaginatedResult } from '../src/common/response/pagination';
import { failure, success } from './utils/envelope';
import { createE2eApp } from './utils/test-app';

/**
 * 12_COMPANY_API.md 6개 엔드포인트(코드조회/헤더데이터/생성/목록/상세/수정) E2E. 관리메뉴
 * 4개(생성/목록/상세/수정)는 SUPER_ADMIN 전용이라 `sa`/`mgr` 시드 계정으로 허용·거부 양쪽을
 * 함께 검증한다. 이 도메인은 로그인 rate limiter 대상 라우트(signup/login)를 딱 2번만 쓰므로
 * (auth.e2e-spec.ts와 달리) 예산 걱정 없이 자유롭게 테스트를 추가해도 된다.
 *
 * **전역 집계 조회 주의**: Jest globalSetup은 `npm run test:e2e` 전체 실행당 1회만 DB를
 * 리셋하고 그 안의 모든 스펙 파일이 같은 DB를 공유한다. 이 파일이 검증하는 "전체 활성 회사"류
 * 조회(active-header-data의 SUPER_ADMIN 응답, status=1 필터 목록의 total_count)는 다른 파일이
 * 만드는 회사까지 자연히 포함되므로 정확한 개수/목록을 단정하지 말고 "최소 포함"(`toBeGreaterThanOrEqual`/
 * `expect.arrayContaining`)으로만 검증할 것 — project.e2e-spec.ts(활성 프로젝트 추가)와
 * log-audit.e2e-spec.ts(활성 회사 추가)가 실제로 이 가정을 두 번 깬 전례가 있다.
 *
 * @author trisakion
 */
describe('Company E2E (12_COMPANY_API.md)', () => {
  let app: INestApplication;
  let saAccessToken: string;
  let mgrAccessToken: string;

  beforeAll(async () => {
    app = await createE2eApp();

    const saLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login_id: 'sa', password: '1234' })
      .expect(200);
    saAccessToken = success<LoginResponseDto>(saLoginRes).data.access_token;

    const mgrLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login_id: 'mgr', password: '1234' })
      .expect(200);
    mgrAccessToken = success<LoginResponseDto>(mgrLoginRes).data.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /companies/lookup — 인증 불필요, 회원가입 화면 전용', () => {
    it('존재하는 company_code는 회사명을 반환한다', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies/lookup')
        .query({ company_code: 'DEV' })
        .expect(200);

      const body = success<CompanyLookupResponseDto>(res);
      expect(body.data.company_id).toBe(2);
      expect(body.data.company_name).toBe('Developer Company');
    });

    it('존재하지 않는 company_code는 COMPANY_NOT_FOUND(31001)', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies/lookup')
        .query({ company_code: 'NO_SUCH_CODE' })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.COMPANY_NOT_FOUND);
    });
  });

  describe('GET /companies/active-header-data — 역할별 스코핑', () => {
    it('SUPER_ADMIN은 전체 활성 회사/프로젝트를 본다', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies/active-header-data')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      // 시드 2개(company 1/2, project 1/2)는 항상 포함돼야 하지만, project.e2e-spec.ts 등
      // 다른 E2E 스펙 파일이 같은 DB 리셋 라이프사이클 안에서 활성 회사/프로젝트를 추가로 만들 수
      // 있어(globalSetup은 전체 `npm run test:e2e` 실행당 1회만 리셋한다) 정확히 [1,2]로만
      // 단정하지 않고 "적어도 포함"으로 검증한다.
      const body = success<ActiveHeaderDataDto>(res);
      const companyIds = body.data.companies.map((c) => c.company_id);
      expect(companyIds).toEqual(expect.arrayContaining([1, 2]));
      const projectIds = body.data.projects.map((p) => p.project_id);
      expect(projectIds).toEqual(expect.arrayContaining([1, 2]));
    });

    it('MANAGER는 본인 소속 회사 1건과 배정된 프로젝트만 본다', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies/active-header-data')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(200);

      const body = success<ActiveHeaderDataDto>(res);
      expect(body.data.companies).toEqual([
        { company_id: 2, company_name: 'Developer Company' },
      ]);
      expect(body.data.projects.map((p) => p.project_id)).toEqual([2]);
    });
  });

  describe('관리메뉴 CRUD (SUPER_ADMIN 전용)', () => {
    let createdCompanyId: number;

    it('POST /companies — SUPER_ADMIN은 새 회사를 생성할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ company_code: 'E2E_CO', company_name: 'E2E 테스트 회사' })
        .expect(200);

      const body = success<CompanyResponseDto>(res);
      expect(body.data.company_code).toBe('E2E_CO');
      expect(body.data.status).toBe(1);
      createdCompanyId = body.data.company_id;
      expect(createdCompanyId).toBeGreaterThan(0);
    });

    it('POST /companies — MANAGER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ company_code: 'SHOULD_FAIL', company_name: '거부되어야 함' })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('POST /companies — 중복된 company_code는 DUPLICATE_DATA(32001)', async () => {
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ company_code: 'E2E_CO', company_name: '중복 코드' })
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });

    it('GET /companies — 방금 만든 회사가 목록/총 개수에 반영된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies')
        .query({ status: 1 })
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);

      // 시드 2개(ADMIN/DEV) + 방금 생성한 1개가 최소 포함돼야 하지만, 같은 DB 리셋
      // 라이프사이클을 공유하는 다른 E2E 스펙 파일(예: log-audit.e2e-spec.ts)도 활성 회사를
      // 만들 수 있어 정확히 3으로 단정하지 않는다(project.e2e-spec.ts 크로스 파일 오염과
      // 동일한 교훈 — company.e2e-spec.ts 파일 헤더 참고할 것).
      const body = success<PaginatedResult<CompanyResponseDto>>(res);
      expect(body.data.total_count).toBeGreaterThanOrEqual(3);
      expect(body.data.items.some((c) => c.company_code === 'E2E_CO')).toBe(
        true,
      );
    });

    it('GET /companies — MANAGER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies')
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('GET /companies/:id — 생성한 회사를 상세 조회할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .get(`/companies/${createdCompanyId}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(200);
      expect(success<CompanyResponseDto>(res).data.company_name).toBe(
        'E2E 테스트 회사',
      );
    });

    it('GET /companies/:id — 존재하지 않는 ID는 COMPANY_NOT_FOUND(31001)', async () => {
      const res = await request(app.getHttpServer())
        .get('/companies/999999')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.COMPANY_NOT_FOUND);
    });

    it('PATCH /companies/:id — 이름/설명/상태를 수정할 수 있다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${createdCompanyId}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({
          company_name: 'E2E 테스트 회사(수정됨)',
          description: '수정된 설명',
          status: 0,
        })
        .expect(200);

      const body = success<CompanyResponseDto>(res);
      expect(body.data.company_name).toBe('E2E 테스트 회사(수정됨)');
      expect(body.data.description).toBe('수정된 설명');
      expect(body.data.status).toBe(0);
    });

    it('PATCH /companies/:id — MANAGER는 PERMISSION_DENIED(20001)로 거부된다', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${createdCompanyId}`)
        .set('Authorization', `Bearer ${mgrAccessToken}`)
        .send({ company_name: '거부되어야 함' })
        .expect(403);
      expect(failure(res).result).toBe(ResultCode.PERMISSION_DENIED);
    });

    it('PATCH /companies/:id — 존재하지 않는 ID는 COMPANY_NOT_FOUND(31001)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/companies/999999')
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ company_name: '유령 회사' })
        .expect(404);
      expect(failure(res).result).toBe(ResultCode.COMPANY_NOT_FOUND);
    });

    it('PATCH /companies/:id — 이미 존재하는 company_code로 바꾸면 DUPLICATE_DATA(32001)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${createdCompanyId}`)
        .set('Authorization', `Bearer ${saAccessToken}`)
        .send({ company_code: 'ADMIN' }) // 시드 회사(company_id=1)가 이미 쓰는 코드
        .expect(400);
      expect(failure(res).result).toBe(ResultCode.DUPLICATE_DATA);
    });
  });
});
