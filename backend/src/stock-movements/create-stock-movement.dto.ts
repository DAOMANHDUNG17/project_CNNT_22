import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ enum: ['IN'], example: 'IN' })
  @Equals('IN')
  movement_type!: 'IN';
}
