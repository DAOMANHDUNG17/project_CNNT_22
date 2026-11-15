import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateStockMovementDto {
  @ApiProperty({ format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID('all')
  transaction_id!: string;

  @ApiProperty({ maxLength: 80, example: 'SW-SP013-BOX24' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  scan_code!: string;

  @ApiProperty({ maxLength: 20, example: 'SCAN-01' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  scan_point_id!: string;

  @ApiProperty({ enum: ['IN', 'OUT'], example: 'OUT' })
  @IsIn(['IN', 'OUT'])
  movement_type!: 'IN' | 'OUT';

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 2147483647, default: 1, description: 'Number of scanned packaging units; omitted legacy requests mean 1.' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity_packages = 1;
}
