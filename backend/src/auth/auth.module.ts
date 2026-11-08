import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [JwtVerifierService, AuthGuard, RolesGuard],
  exports: [JwtVerifierService, AuthGuard, RolesGuard],
})
export class AuthModule {}
