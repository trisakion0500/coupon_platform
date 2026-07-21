import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * PATCH /projects/{project_id} 요청 바디. 11_PROJECT_API.md 2.4의 Updatable Fields만 받는다
 * (company_id/project_code/api_key/api_secret은 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰으로, GET /projects/{id}에서 마지막으로 받은
 * 값을 그대로 되돌려 보낸다(11_PROJECT_API.md 2.4 Concurrency, coupon_campaign과 동일 패턴).
 * 서버의 현재 값과 다르면 그 사이 다른 관리자가 먼저 수정했다는 뜻이라 30005로 거부된다.
 *
 * @author trisakion
 */
export class UpdateProjectDto {
  @IsInt()
  @Min(0)
  edit_count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  project_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
