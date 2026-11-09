import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProductUnitDto {
  @ApiProperty({ example: 'SP013', maxLength: 20 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  product_id!: string;

  @ApiProperty({ example: 'hộp', maxLength: 30 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit_name!: string;

  @ApiProperty({ example: 20, minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  conversion_factor!: number;

  @ApiProperty({ example: 'SW-SP013-20', maxLength: 80 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  scan_code!: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  is_base_unit!: boolean;
}
