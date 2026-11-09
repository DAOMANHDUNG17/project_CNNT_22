import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProductIdParamDto {
  @ApiProperty({ example: 'SP013', maxLength: 20 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  id!: string;
}

export class PatchProductDto {
  @ApiPropertyOptional({ example: 'Bút mực Hồng Hà', maxLength: 150 })
  @Transform(trimString)
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  product_name?: string;

  @ApiPropertyOptional({ example: false })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  is_active?: boolean;
}
