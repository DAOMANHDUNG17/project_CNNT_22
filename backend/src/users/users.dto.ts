import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const supplied = (_: unknown, value: unknown) => value !== undefined;
const roles = ['ADMIN', 'STAFF', 'VIEWER'];

export class CreateUserDto {
  @ApiProperty({ maxLength: 50 }) @Transform(trim) @IsString() @Length(1, 50) @Matches(/^[A-Za-z0-9_.-]+$/)
  username!: string;
  @ApiProperty({ maxLength: 120 }) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) @Matches(/^\P{Cc}+$/u)
  display_name!: string;
  @ApiProperty({ format: 'email', maxLength: 254 }) @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @MaxLength(254)
  email!: string;
  @ApiProperty({ enum: roles }) @IsIn(roles)
  role!: 'ADMIN' | 'STAFF' | 'VIEWER';
  @ApiProperty({ writeOnly: true, minLength: 12, maxLength: 128 }) @IsString() @Length(12, 128)
  password!: string;
  @ApiPropertyOptional({ default: true }) @ValidateIf(supplied) @IsBoolean()
  is_active?: boolean;
}

export class PatchUserDto {
  @ApiPropertyOptional({ maxLength: 50 }) @ValidateIf(supplied) @Transform(trim) @IsString() @Length(1, 50) @Matches(/^[A-Za-z0-9_.-]+$/)
  username?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @ValidateIf(supplied) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) @Matches(/^\P{Cc}+$/u)
  display_name?: string;
  @ApiPropertyOptional({ enum: roles }) @ValidateIf(supplied) @IsIn(roles)
  role?: 'ADMIN' | 'STAFF' | 'VIEWER';
  @ApiPropertyOptional() @ValidateIf(supplied) @IsBoolean()
  is_active?: boolean;
}

export class UserIdDto {
  @ApiProperty({ type: String, description: 'Positive PostgreSQL BIGINT' }) @IsString() @Matches(/^[1-9][0-9]{0,18}$/)
  id!: string;
}

export class UsersQueryDto {
  @ApiPropertyOptional({ default: 1 }) @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  page = 1;
  @ApiPropertyOptional({ default: 20 }) @Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value) @IsInt() @Min(1) @Max(100)
  limit = 20;
  @ApiPropertyOptional({ maxLength: 150 }) @ValidateIf(supplied) @Transform(trim) @IsString() @MaxLength(150)
  q?: string;
  @ApiPropertyOptional({ enum: roles }) @ValidateIf(supplied) @IsIn(roles)
  role?: string;
  @ApiPropertyOptional({ type: Boolean }) @ValidateIf(supplied) @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean()
  isActive?: boolean;
}
