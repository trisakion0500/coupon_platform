import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { ResultCode } from '../common/response/result-code.enum';
import { CouponUsageService } from './coupon-usage.service';

describe('CouponUsageService', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'logCall'>>;
  let service: CouponUsageService;

  const reserveRow = {
    coupon_code_usage_id: 9000,
    coupon_campaign_id: 100,
    code_value: '23A4-B7C9-DEF2',
    game_user_id: 'player_1001',
    reward_data: { item_id: 5001, qty: 3 },
    created_at: '2026-07-22 10:00:00',
  };

  const confirmRow = {
    coupon_code_usage_id: 9000,
    coupon_campaign_id: 100,
    confirmed_at: '2026-07-22 10:00:05',
  };

  const codeLookupRow = {
    coupon_code_id: 5001,
    coupon_campaign_id: 100,
    status: 2,
  };

  beforeEach(() => {
    spExecutor = { callProcedure: jest.fn() };
    logSpExecutor = { logCall: jest.fn() };
    service = new CouponUsageService(
      spExecutor as unknown as SpExecutorService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  describe('reserve', () => {
    it('returns the reserved row and logs a success attempt', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [reserveRow],
      });

      const result = await service.reserve(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10');

      expect(result).toEqual(reserveRow);
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [10, 10, 100, '23A4-B7C9-DEF2', 'player_1001', 0, '203.0.113.10'],
      );
    });

    it('throws COUPON_CODE_NOT_FOUND on 31005 without a campaign_id lookup', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31005 });

      await expect(
        service.reserve(10, 'NOPE', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({ resultCode: ResultCode.COUPON_CODE_NOT_FOUND });

      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1);
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [10, 10, null, 'NOPE', 'player_1001', 10, '203.0.113.10'],
      );
    });

    it('throws COUPON_CODE_ALREADY_USED_OR_STOPPED on 33001 and enriches the log with campaign_id', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 33001 });
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [codeLookupRow],
      });

      await expect(
        service.reserve(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({
        resultCode: ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED,
      });

      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_COUPON_CODE_GET_BY_VALUE',
        [10, '23A4-B7C9-DEF2'],
      );
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [10, 10, 100, '23A4-B7C9-DEF2', 'player_1001', 20, '203.0.113.10'],
      );
    });

    it('throws CAMPAIGN_NOT_USABLE on 33002', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 33002 });
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [codeLookupRow],
      });

      await expect(
        service.reserve(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({ resultCode: ResultCode.CAMPAIGN_NOT_USABLE });
    });

    it('throws USER_USE_LIMIT_EXCEEDED on 33003', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 33003 });
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [codeLookupRow],
      });

      await expect(
        service.reserve(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({ resultCode: ResultCode.USER_USE_LIMIT_EXCEEDED });
    });

    it('logs campaign_id=null when the enrichment lookup itself fails', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 33001 });
      spExecutor.callProcedure.mockRejectedValueOnce(new Error('connection refused'));

      await expect(
        service.reserve(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({
        resultCode: ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED,
      });

      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [10, 10, null, '23A4-B7C9-DEF2', 'player_1001', 20, '203.0.113.10'],
      );
    });
  });

  describe('confirm', () => {
    it('returns coupon_code_usage_id/confirmed_at only and logs a success attempt', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [confirmRow],
      });

      const result = await service.confirm(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10');

      expect(result).toEqual({
        coupon_code_usage_id: 9000,
        confirmed_at: '2026-07-22 10:00:05',
      });
      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [20, 10, 100, '23A4-B7C9-DEF2', 'player_1001', 0, '203.0.113.10'],
      );
    });

    it('throws COUPON_CODE_NOT_FOUND on 31005', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31005 });

      await expect(
        service.confirm(10, 'NOPE', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({ resultCode: ResultCode.COUPON_CODE_NOT_FOUND });
    });

    it('throws USAGE_NOT_FOUND on 31006 and enriches the log with campaign_id', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({ result: 31006 });
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [codeLookupRow],
      });

      await expect(
        service.confirm(10, '23A4-B7C9-DEF2', 'player_1001', '203.0.113.10'),
      ).rejects.toMatchObject({ resultCode: ResultCode.USAGE_NOT_FOUND });

      expect(logSpExecutor.logCall).toHaveBeenCalledWith(
        'SP_LOG_COUPON_USE_CREATE',
        [20, 10, 100, '23A4-B7C9-DEF2', 'player_1001', 50, '203.0.113.10'],
      );
    });
  });

  describe('listUnconfirmed', () => {
    it('specific-user mode returns items only (no pagination fields)', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            coupon_campaign_id: 100,
            reward_data: { item_id: 5001, qty: 3 },
            created_at: '2026-07-18 10:00:00',
            total_count: 1,
          },
        ],
      });

      const result = await service.listUnconfirmed(10, {
        game_user_id: 'player_1001',
      });

      expect(result).toEqual({
        items: [
          {
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            coupon_campaign_id: 100,
            reward_data: { item_id: 5001, qty: 3 },
            created_at: '2026-07-18 10:00:00',
          },
        ],
      });
      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_COUPON_UNCONFIRMED_LIST',
        [10, 'player_1001', null, null, null],
      );
    });

    it('all-users mode returns a paginated result', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [
          {
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            coupon_campaign_id: 100,
            reward_data: { item_id: 5001, qty: 3 },
            created_at: '2026-07-18 10:00:00',
            total_count: 5,
          },
        ],
      });

      const result = await service.listUnconfirmed(10, {
        page: 1,
        page_size: 20,
      });

      expect(result).toEqual({
        page: 1,
        page_size: 20,
        total_count: 5,
        items: [
          {
            code_value: '23A4-B7C9-DEF2',
            game_user_id: 'player_1001',
            coupon_campaign_id: 100,
            reward_data: { item_id: 5001, qty: 3 },
            created_at: '2026-07-18 10:00:00',
          },
        ],
      });
      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_COUPON_UNCONFIRMED_LIST',
        [10, null, null, 20, 0],
      );
    });

    it('throws REQUIRED_FIELD_MISSING when game_user_id is absent and page/page_size are missing', async () => {
      await expect(service.listUnconfirmed(10, {})).rejects.toMatchObject({
        resultCode: ResultCode.REQUIRED_FIELD_MISSING,
      });
      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });
  });
});
