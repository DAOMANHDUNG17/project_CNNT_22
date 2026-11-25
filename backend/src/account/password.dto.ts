import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ writeOnly: true, minLength: 8, maxLength: 128, description: 'Must also satisfy the configured Supabase Auth policy' })
  @IsString({ message: 'Mật khẩu mới phải là chuỗi.' })
  @Length(8, 128, { message: 'Mật khẩu mới phải có 8–128 ký tự.' })
  new_password!: string;

  @ApiProperty({ writeOnly: true, minLength: 8, maxLength: 128 })
  @IsString({ message: 'Vui lòng xác nhận mật khẩu mới.' })
  @Length(8, 128, { message: 'Xác nhận mật khẩu phải có 8–128 ký tự.' })
  confirm_password!: string;
}

export class ChangePasswordDto extends ResetPasswordDto {
  @ApiProperty({ writeOnly: true, minLength: 1, maxLength: 1024 })
  @IsString({ message: 'Vui lòng nhập mật khẩu hiện tại.' })
  @Length(1, 1024, { message: 'Mật khẩu hiện tại không hợp lệ.' })
  current_password!: string;
}
