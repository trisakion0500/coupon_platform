import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * 14_USER_API.md 1장(User) 도메인 모듈 — 목록/상세/승인/반려/수정/비밀번호초기화 7개 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule, CryptoModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
