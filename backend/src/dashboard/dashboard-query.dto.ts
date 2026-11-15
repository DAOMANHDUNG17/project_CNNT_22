import { Transform } from 'class-transformer';
import { IsIn, IsInt, Matches, Max, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const optional = (_: unknown, value: unknown) => value !== undefined;
const date = /^\d{4}-\d{2}-\d{2}$/;
const integer = ({ value }: { value: unknown }) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;

export class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Inclusive UTC date, YYYY-MM-DD' })
  @ValidateIf(optional)
  @Matches(date)
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive UTC date, YYYY-MM-DD' })
  @ValidateIf(optional)
  @Matches(date)
  to?: string;

  @ApiPropertyOptional({ enum: ['day', 'month'], default: 'day' })
  @IsIn(['day', 'month'])
  granularity: 'day' | 'month' = 'day';

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 5, minimum: 1, maximum: 100 })
  @Transform(integer)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 5;
}
