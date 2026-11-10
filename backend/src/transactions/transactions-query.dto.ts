import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const queryInteger = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
const supplied = (_: unknown, value: unknown) => value !== undefined;
const zonedDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export class TransactionsQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exact transaction UUID' })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsUUID('all')
  transactionId?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[^\0]+$/u)
  productId?: string;

  @ApiPropertyOptional({ enum: ['IN', 'OUT'] })
  @ValidateIf(supplied)
  @IsIn(['IN', 'OUT'])
  movementType?: 'IN' | 'OUT';

  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[^\0]+$/u)
  scanPointId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Inclusive ISO 8601 datetime with timezone; up to six fractional digits' })
  @ValidateIf(supplied)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(zonedDatetime)
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Exclusive ISO 8601 datetime with timezone; must be after from' })
  @ValidateIf(supplied)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(zonedDatetime)
  to?: string;
}
