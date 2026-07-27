import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { UserRoleController } from './user-role.controller';
import { UserRoleService } from './user-role.service';

/**
 * 13_PROJECT_API.md 3.1 `GET /user-roles/me` 전용 모듈.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule],
  controllers: [UserRoleController],
  providers: [UserRoleService],
})
export class UserRoleModule {}
