import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProductDto {
  @ApiProperty({ example: 'SP013', maxLength: 20 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  product_id!: string;

  @ApiProperty({ example: 'Bút mực Hồng Hà', maxLength: 150 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  product_name!: string;

  @ApiProperty({ example: 'cây', maxLength: 30 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  base_unit!: string;
}
