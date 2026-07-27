import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ACTIONS = [10, 20] as const;
const RESULT_TYPES = [0, 10, 20, 30, 40, 50] as const;

/**
 * GET /coupon-use-logs 쿼리 파라미터. 19_CAMPAIGN_API.md 4.3 — `project_id`는 스코핑 기준이라
 * 필수지만, 미지정 시 정확히 30001(REQUIRED_FIELD_MISSING)로 응답해야 해서 여기서는 선택으로
 * 두고 `CouponUseLogService.list`가 명시적으로 체크한다(`UnconfirmedQueryDto`와 동일 이유 —
 * class-validator의 필수값 누락은 ValidationPipe의 일반 400(->30002)으로만 떨어진다).
 *
 * @author trisakion
 */
export class CouponUseLogListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '프로젝트 ID(필수, 스코핑 기준)',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @ApiPropertyOptional({ description: '캠페인 ID 필터', example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  coupon_campaign_id?: number;

  @ApiPropertyOptional({
    description: '게임 유저 ID 필터',
    example: 'player_1001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  @ApiPropertyOptional({
    description: '코드 값 필터',
    example: '23A4-B7C9-DEF2',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code_value?: string;

  @ApiPropertyOptional({
    description: '작업유형 필터(10:RESERVE/20:CONFIRM)',
    enum: ACTIONS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;

  @ApiPropertyOptional({
    description:
      '결과유형 필터(0:성공/10:코드없음/20:이미소모·중지/30:캠페인 사용불가/40:사용자한도초과/50:소모기록없음)',
    enum: RESULT_TYPES,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(RESULT_TYPES)
  result_type?: number;

  @ApiPropertyOptional({
    description: '조회 시작일시',
    example: '2026-08-01 00:00:00',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  from_created_at?: string;

  @ApiPropertyOptional({
    description: '조회 종료일시',
    example: '2026-08-31 23:59:59',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  to_created_at?: string;
}
