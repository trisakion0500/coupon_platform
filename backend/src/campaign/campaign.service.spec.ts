import { ConfigService } from '@nestjs/config';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { CampaignService } from './campaign.service';

describe('CampaignService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'logCall'>>;
  let configService: ConfigService;
  let service: CampaignService;

  const campaignRow = {
    coupon_campaign_id: 100,
    project_id: 10,
    name: '여름 이벤트 쿠폰',
    campaign_start: '2026-08-01 00:00:00',
    campaign_end: '2026-08-31 23:59:59',
    code_type: 1,
    use_hyphen: 1,
    requested_qty: 1000,
    generated_qty: 0,
    generation_status: 1,
    generation_error: null,
    usable_qty: 0,
    used_qty: 0,
    use_limit_per_user: 1,
    status: 1,
    approval_status: 2,
    approved_by: null,
    approved_at: null,
    reject_reason: null,
    reward_data: { item_id: 5001, qty: 3 },
    created_by: 4,
    updated_by: 4,
    created_at: '2026-07-20 10:00:00',
    updated_at: '2026-07-20 10:00:00',
    edit_count: 0,
  };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { logCall: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'CODE_GENERATION_MAX_DB_RETRIES') return 5;
        if (key === 'CODE_GENERATION_RETRY_BASE_DELAY_MS') return 200;
        if (key === 'CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER') return 3;
        throw new Error(`unexpected config key requested: ${key}`);
      }),
    } as unknown as ConfigService;
    service = new CampaignService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
      configService,
    );
  });

  describe('create', () => {
    const dto = {
      project_id: 10,
      name: '여름 이벤트 쿠폰',
      campaign_start: '2026-08-01 00:00:00',
      campaign_end: '2026-08-31 23:59:59',
      code_type: 1,
      requested_qty: 1000,
      reward_data: { item_id: 5001, qty: 3 },
    };

    it('returns the created campaign and fires a log_coupon_campaign write', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      const result = await service.create(dto, 4);

      expect(result).toEqual(campaignRow);
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_CAMPAIGN_CREATE',
        expect.arrayContaining([10, 100, 10]),
      );
    });

    it('serializes reward_data to a JSON string before calling the SP', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      await service.create(dto, 4);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_CREATE',
        [
          10,
          '여름 이벤트 쿠폰',
          '2026-08-01 00:00:00',
          '2026-08-31 23:59:59',
          1,
          1,
          1000,
          1,
          JSON.stringify(dto.reward_data),
          4,
        ],
      );
    });

    it('throws PROJECT_NOT_FOUND on 31002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
      await expect(service.create(dto, 4)).rejects.toMatchObject({
        resultCode: ResultCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.create(dto, 4)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('list', () => {
    it('strips total_count and builds a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: 100,
            project_id: 10,
            name: '여름 이벤트 쿠폰',
            code_type: 1,
            requested_qty: 1000,
            generated_qty: 1000,
            generation_status: 3,
            usable_qty: 500,
            used_qty: 120,
            status: 2,
            approval_status: 3,
            campaign_start: '2026-08-01 00:00:00',
            campaign_end: '2026-08-31 23:59:59',
            created_at: '2026-07-20 10:00:00',
            updated_at: '2026-07-20 10:00:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.list(
        { page: 1, page_size: 20, project_id: 10 },
        { userId: 1 },
      );

      expect(result.total_count).toBe(1);
      expect(result.items[0].coupon_campaign_id).toBe(100);
    });

    it('reports the real total_count when the requested page is out of range', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: null,
            project_id: 10,
            name: null,
            code_type: null,
            requested_qty: null,
            generated_qty: null,
            generation_status: null,
            usable_qty: null,
            used_qty: null,
            status: null,
            approval_status: null,
            campaign_start: null,
            campaign_end: null,
            created_at: null,
            updated_at: null,
            total_count: 3,
          },
        ],
      });

      const result = await service.list(
        { page: 2, page_size: 20, project_id: 10 },
        { userId: 1 },
      );

      expect(result).toEqual({
        page: 2,
        page_size: 20,
        total_count: 3,
        items: [],
      });
    });

    it('throws PERMISSION_DENIED when the SP rejects the project scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.list({ page: 1, page_size: 20, project_id: 10 }, { userId: 2 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('getById', () => {
    it('returns the campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });
      await expect(service.getById(100, { userId: 1 })).resolves.toEqual(
        campaignRow,
      );
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(service.getById(999, { userId: 1 })).rejects.toMatchObject({
        resultCode: ResultCode.CAMPAIGN_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED when out of scope (20001)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.getById(100, { userId: 2 })).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });
  });

  describe('update', () => {
    it('returns the updated campaign and fires a log_coupon_campaign write', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      const result = await service.update(
        100,
        { edit_count: 0, name: 'Renamed' },
        4,
      );

      expect(result).toEqual(campaignRow);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('passes edit_count through as the optimistic-lock token', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [campaignRow],
      });

      await service.update(100, { edit_count: 0, name: 'Renamed' }, 4);

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_UPDATE',
        [100, 0, 'Renamed', null, null, null, null, null, 4],
      );
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.update(999, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (ended campaign)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.update(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws DISALLOWED_VALUE on 30003 (usable_qty > generated_qty)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30003 });
      await expect(
        service.update(100, { edit_count: 0, usable_qty: 99999 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.DISALLOWED_VALUE });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count — someone else edited it first)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.update(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('changeStatus', () => {
    it('returns the campaign after a valid transition', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, status: 2 }],
      });

      const result = await service.changeStatus(
        100,
        { edit_count: 0, status: 2 },
        4,
      );

      expect(result.status).toBe(2);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.changeStatus(100, { edit_count: 0, status: 4 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.changeStatus(999, { edit_count: 0, status: 2 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.changeStatus(100, { edit_count: 0, status: 2 }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('approve', () => {
    it('returns the approved campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, approval_status: 3 }],
      });

      const result = await service.approve(100, { edit_count: 0 }, 1);

      expect(result.approval_status).toBe(3);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws PERMISSION_DENIED when the SP rejects (20001, e.g. OPERATOR)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.approve(100, { edit_count: 0 }, 4),
      ).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.approve(100, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.approve(100, { edit_count: 0 }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('reject', () => {
    it('returns the rejected campaign', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ ...campaignRow, approval_status: 4, reject_reason: 'nope' }],
      });

      const result = await service.reject(
        100,
        { edit_count: 0, reject_reason: 'nope' },
        1,
      );

      expect(result.approval_status).toBe(4);
      expect(logSpExecutor.logCall).toHaveBeenCalled();
    });

    it('throws INVALID_STATE_TRANSITION on 30004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(
        service.reject(100, { edit_count: 0, reject_reason: 'nope' }, 1),
      ).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws UPDATE_CONFLICT on 30005 (stale edit_count)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30005 });
      await expect(
        service.reject(100, { edit_count: 0, reject_reason: 'nope' }, 1),
      ).rejects.toMatchObject({ resultCode: ResultCode.UPDATE_CONFLICT });
    });
  });

  describe('issueCodes', () => {
    it('returns the FIXED response synchronously and does not start a background loop', async () => {
      const generateSpy = jest
        .spyOn(
          service as unknown as {
            generateRandomCodes: (...args: unknown[]) => Promise<void>;
          },
          'generateRandomCodes',
        )
        .mockResolvedValue(undefined);

      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: 100,
            project_id: 10,
            code_type: 2,
            use_hyphen: 0,
            requested_qty: 1,
            generated_qty: 1,
            generation_status: 3,
            coupon_code_id: 5000,
            code_value: 'SUMMER2024',
            code_status: 1,
          },
        ],
      });

      const result = await service.issueCodes(
        100,
        { code_value: 'SUMMER2024' },
        4,
      );

      expect(result).toEqual({
        coupon_campaign_id: 100,
        generation_status: 3,
        generated_qty: 1,
        coupon_code: {
          coupon_code_id: 5000,
          code_value: 'SUMMER2024',
          status: 1,
        },
      });
      expect(generateSpy).not.toHaveBeenCalled();
    });

    it('returns the RANDOM response immediately and fires the background generation loop', async () => {
      const generateSpy = jest
        .spyOn(
          service as unknown as {
            generateRandomCodes: (...args: unknown[]) => Promise<void>;
          },
          'generateRandomCodes',
        )
        .mockResolvedValue(undefined);

      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: 100,
            project_id: 10,
            code_type: 1,
            use_hyphen: 1,
            requested_qty: 1000,
            generated_qty: 0,
            generation_status: 2,
            coupon_code_id: null,
            code_value: null,
            code_status: null,
          },
        ],
      });

      const result = await service.issueCodes(100, {}, 4);

      expect(result).toEqual({ coupon_campaign_id: 100, generation_status: 2 });
      expect(generateSpy).toHaveBeenCalledWith({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 1000,
        generated_qty: 0,
      });
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(service.issueCodes(999, {}, 4)).rejects.toMatchObject({
        resultCode: ResultCode.CAMPAIGN_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED on 20001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.issueCodes(100, {}, 4)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws REQUIRED_FIELD_MISSING on 30001 (FIXED without code_value)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30001 });
      await expect(service.issueCodes(100, {}, 4)).rejects.toMatchObject({
        resultCode: ResultCode.REQUIRED_FIELD_MISSING,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (already issued or campaign ended)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(service.issueCodes(100, {}, 4)).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws DUPLICATE_DATA on 32001 (FIXED code_value collision)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 32001 });
      await expect(
        service.issueCodes(100, { code_value: 'DUP' }, 4),
      ).rejects.toMatchObject({ resultCode: ResultCode.DUPLICATE_DATA });
    });
  });

  describe('retryCodeIssuance', () => {
    it('resumes the background loop with the remaining quantity and returns generation_status', async () => {
      const generateSpy = jest
        .spyOn(
          service as unknown as {
            generateRandomCodes: (...args: unknown[]) => Promise<void>;
          },
          'generateRandomCodes',
        )
        .mockResolvedValue(undefined);

      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_campaign_id: 100,
            project_id: 10,
            use_hyphen: 1,
            requested_qty: 1000,
            generated_qty: 400,
            generation_status: 2,
          },
        ],
      });

      const result = await service.retryCodeIssuance(100, 4);

      expect(result).toEqual({ coupon_campaign_id: 100, generation_status: 2 });
      expect(generateSpy).toHaveBeenCalledWith({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 1000,
        generated_qty: 400,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (not currently failed)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(service.retryCodeIssuance(100, 4)).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(service.retryCodeIssuance(999, 4)).rejects.toMatchObject({
        resultCode: ResultCode.CAMPAIGN_NOT_FOUND,
      });
    });
  });

  describe('abortCodeGeneration', () => {
    it('computes the stale threshold from retry settings and returns the new generation_status', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ coupon_campaign_id: 100, generation_status: 4 }],
      });

      const result = await service.abortCodeGeneration(100, 1);

      expect(result).toEqual({ coupon_campaign_id: 100, generation_status: 4 });
      // baseDelay(200) * (2^retries(5) - 1) = 6200ms, * multiplier(3) = 18600ms -> ceil(18.6s) = 19s
      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_ABORT',
        [100, 19, 1],
      );
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(service.abortCodeGeneration(999, 1)).rejects.toMatchObject({
        resultCode: ResultCode.CAMPAIGN_NOT_FOUND,
      });
    });

    it('throws PERMISSION_DENIED on 20001 (e.g. OPERATOR)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(service.abortCodeGeneration(100, 4)).rejects.toMatchObject({
        resultCode: ResultCode.PERMISSION_DENIED,
      });
    });

    it('throws INVALID_STATE_TRANSITION on 30004 (not stale enough / not in progress / campaign ended)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 30004 });
      await expect(service.abortCodeGeneration(100, 1)).rejects.toMatchObject({
        resultCode: ResultCode.INVALID_STATE_TRANSITION,
      });
    });
  });

  describe('listCodes', () => {
    it('strips total_count and builds a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            coupon_code_id: 5001,
            code_value: '23A4-B7C9-DEF2',
            status: 1,
            created_at: '2026-07-17 10:05:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.listCodes(
        100,
        { page: 1, page_size: 20 },
        { userId: 1 },
      );

      expect(result.total_count).toBe(1);
      expect(result.items[0].coupon_code_id).toBe(5001);
    });

    it('throws CAMPAIGN_NOT_FOUND on 31004', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31004 });
      await expect(
        service.listCodes(999, { page: 1, page_size: 20 }, { userId: 1 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_FOUND });
    });

    it('throws PERMISSION_DENIED on 20001', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 20001 });
      await expect(
        service.listCodes(100, { page: 1, page_size: 20 }, { userId: 2 }),
      ).rejects.toMatchObject({ resultCode: ResultCode.PERMISSION_DENIED });
    });
  });

  describe('generateRandomCodes (background loop)', () => {
    /** private 메서드지만 fire-and-forget 루프의 재시도/종료 로직 자체를 검증해야 한다. */
    const runLoop = (
      job: Parameters<
        (typeof CampaignService.prototype)['generateRandomCodes']
      >[0],
    ) =>
      (
        service as unknown as {
          generateRandomCodes: (j: typeof job) => Promise<void>;
        }
      ).generateRandomCodes(job);

    it('retries immediately on code collision (32001) without backing off', async () => {
      spExecutor.callProcedure
        .mockResolvedValueOnce({ result: 32001 }) // 첫 시도 충돌
        .mockResolvedValueOnce({
          result: 0,
          data: [{ generated_qty: 1, generation_status: 2 }],
        })
        .mockResolvedValueOnce({ result: 0 }); // SP_CAMPAIGN_CODE_GENERATION_COMPLETE

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 1,
        generated_qty: 0,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(3);
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        3,
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        [100],
      );
    });

    it('marks generation_status as failed after exhausting DB-error retries', async () => {
      jest.useFakeTimers();
      try {
        spExecutor.callProcedure.mockRejectedValue(
          new Error('connection refused'),
        );

        const loopPromise = runLoop({
          coupon_campaign_id: 100,
          project_id: 10,
          use_hyphen: 1,
          requested_qty: 1,
          generated_qty: 0,
        });
        await jest.runAllTimersAsync();
        await loopPromise;

        const finalizeCall = spExecutor.callProcedure.mock.calls.find(
          ([spName]) => spName === 'SP_CAMPAIGN_CODE_GENERATION_FAIL',
        );
        expect(finalizeCall).toBeDefined();
        expect(finalizeCall?.[1]?.[0]).toBe(100);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does nothing when the requested quantity is already generated (retry with 0 remaining)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 0 });

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 5,
        generated_qty: 5,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        [100],
      );
    });

    it('stops after one call when SP_CAMPAIGN_CODE_GENERATE_ONE reports the cap was already reached (lost-ack self-healing)', async () => {
      // 로컬 카운터는 4/5로 뒤처져 있지만(직전 호출의 성공 응답을 못 받은 상황을 흉내), SP는
      // requested_qty 상한 가드 덕분에 이미 5(=목표)임을 그대로 보고한다 — 코드를 하나 더
      // 만들지 않고 즉시 완료 처리로 이어져야 한다(SP_CAMPAIGN_CODE_GENERATE_ONE.sql 수정1 참고).
      spExecutor.callProcedure
        .mockResolvedValueOnce({
          result: 0,
          data: [{ generated_qty: 5, generation_status: 2 }],
        })
        .mockResolvedValueOnce({ result: 0 }); // SP_CAMPAIGN_CODE_GENERATION_COMPLETE

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 5,
        generated_qty: 4,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(2);
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        1,
        'SP_CAMPAIGN_CODE_GENERATE_ONE',
        expect.arrayContaining([100, 10]),
      );
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        [100],
      );
    });

    it('retries a retryable DB error (deadlock, errorNo=1213) with backoff, then succeeds', async () => {
      jest.useFakeTimers();
      try {
        spExecutor.callProcedure
          .mockRejectedValueOnce(
            new BusinessException(ResultCode.DATABASE_ERROR, undefined, {
              sqlState: '40001',
              errorNo: 1213,
            }),
          )
          .mockResolvedValueOnce({
            result: 0,
            data: [{ generated_qty: 1, generation_status: 2 }],
          })
          .mockResolvedValueOnce({ result: 0 }); // SP_CAMPAIGN_CODE_GENERATION_COMPLETE

        const loopPromise = runLoop({
          coupon_campaign_id: 100,
          project_id: 10,
          use_hyphen: 1,
          requested_qty: 1,
          generated_qty: 0,
        });
        await jest.runAllTimersAsync();
        await loopPromise;

        expect(spExecutor.callProcedure).toHaveBeenCalledTimes(3);
        expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
          3,
          'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
          [100],
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('fails immediately (no backoff) on a non-retryable DB error', async () => {
      spExecutor.callProcedure
        .mockRejectedValueOnce(
          new BusinessException(ResultCode.DATABASE_ERROR, undefined, {
            sqlState: '23000',
            errorNo: 1452, // FK 제약 위반류 — 재시도해도 절대 안 바뀜
          }),
        )
        .mockResolvedValueOnce({ result: 0 }); // SP_CAMPAIGN_CODE_GENERATION_FAIL

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 1,
        generated_qty: 0,
      });

      // GENERATE_ONE 1회 + GENERATION_FAIL 1회뿐 — 재시도(backoff) 없이 곧바로 실패 처리됐다는 뜻
      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(2);
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_CAMPAIGN_CODE_GENERATION_FAIL',
        [100, expect.any(String)],
      );
    });

    it('fails immediately when the SP returns an unexpected RESULT (contract violation)', async () => {
      spExecutor.callProcedure
        .mockResolvedValueOnce({ result: 12345 }) // 0도 32001도 아닌, 계약 위반 상황
        .mockResolvedValueOnce({ result: 0 }); // SP_CAMPAIGN_CODE_GENERATION_FAIL

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 1,
        generated_qty: 0,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(2);
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_CAMPAIGN_CODE_GENERATION_FAIL',
        [100, expect.any(String)],
      );
    });

    it('stops quietly (no COMPLETE/FAIL call) when the job was reclaimed externally (e.g. POST /codes/abort)', async () => {
      // generated_qty(2)는 아직 목표(5) 미달이지만 generation_status가 더 이상 2가 아니다 -
      // 누군가(관리자의 abort 등) 이미 이 job의 최종 상태를 결정했다는 뜻이므로, 좀비 루프는
      // 추가 생성 시도도, COMPLETE/FAIL 호출도 없이 조용히 멈춰야 한다.
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ generated_qty: 2, generation_status: 4 }],
      });

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 5,
        generated_qty: 1,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1);
      expect(spExecutor.callProcedure).not.toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        expect.anything(),
      );
      expect(spExecutor.callProcedure).not.toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_GENERATION_FAIL',
        expect.anything(),
      );
    });

    it('stops quietly (no COMPLETE/FAIL call) when the campaign itself was ended (status=4) mid-generation', async () => {
      // generation_status는 여전히 2(진행중)지만 - 종료는 별개 축이라 이 컬럼을 안 건드림 -
      // status=4(종료)가 됐다는 건 관리자가 캠페인을 끝냈다는 뜻이므로, 이 역시 좀비 루프가
      // 추가 생성 없이 조용히 멈춰야 하는 케이스다(generation_status만 보고는 못 잡는 케이스).
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ generated_qty: 2, generation_status: 2, status: 4 }],
      });

      await runLoop({
        coupon_campaign_id: 100,
        project_id: 10,
        use_hyphen: 1,
        requested_qty: 5,
        generated_qty: 1,
      });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1);
      expect(spExecutor.callProcedure).not.toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        expect.anything(),
      );
      expect(spExecutor.callProcedure).not.toHaveBeenCalledWith(
        'SP_CAMPAIGN_CODE_GENERATION_FAIL',
        expect.anything(),
      );
    });
  });
});
