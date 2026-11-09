import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProductUnitIdParamDto {
  @ApiProperty({ example: '29', description: 'Positive BIGINT product unit ID' })
  @IsString()
  @Matches(/^[1-9][0-9]{0,18}$/)
  id!: string;
}

export class PatchProductUnitDto {
  @ApiPropertyOptional({ example: 'Chiếc', maxLength: 30, description: 'Renaming a base unit also updates products.base_unit' })
  @Transform(trimString)
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unit_name?: string;

  @ApiPropertyOptional({ example: 'SW-SP001-BOX', maxLength: 80 })
  @Transform(trimString)
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  scan_code?: string;

  @ApiPropertyOptional({ example: 120, minimum: 1, maximum: 2147483647 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  conversion_factor?: number;
}
