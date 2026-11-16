import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaceScanPointAccessDto {
  @ApiProperty({ type: [String], maxItems: 100, uniqueItems: true, description: 'Complete selected scan point IDs. Empty array revokes every grant.' })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, { each: true })
  scan_point_ids!: string[];
}

// The current account always comes from AuthGuard; no user ID query is accepted.
export class MyScanPointsQueryDto {}
