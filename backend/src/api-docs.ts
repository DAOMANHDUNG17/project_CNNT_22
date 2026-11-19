import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const apiTags = {
  account: '01 — Xác thực & tài khoản',
  catalog: '02 — Danh mục sản phẩm',
  inventory: '03 — Quản lý tồn kho',
  movements: '04 — Nhập / xuất kho',
  history: '05 — Lịch sử giao dịch',
  scanPoints: '06 — Điểm quét & phân công',
  administration: '07 — Quản trị hệ thống',
} as const;

export function createApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Smart Warehouse API')
    .setDescription('Dùng **Authorize** để nhập access token Supabase. Demo KT2 nằm ở mục **04 — Nhập / xuất kho**.')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag(apiTags.account, 'Kiểm tra hồ sơ và vai trò của phiên hiện tại.')
    .addTag(apiTags.catalog, 'Sản phẩm, đơn vị đóng gói, mã quét và hệ số quy đổi.')
    .addTag(apiTags.inventory, 'Tồn hiện tại và các chỉ số tổng hợp của kho.')
    .addTag(apiTags.movements, 'Ghi nhận nhập/xuất và kiểm thử chống trùng UUID.')
    .addTag(apiTags.history, 'Lọc lịch sử và tra cứu giao dịch theo UUID.')
    .addTag(apiTags.scanPoints, 'Điểm quét và quyền sử dụng của từng tài khoản.')
    .addTag(apiTags.administration, 'Quản lý tài khoản và kiểm tra tình trạng dịch vụ.')
    .build();

  return SwaggerModule.createDocument(app, config, { autoTagControllers: false });
}

export function setupApiDocs(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, createApiDocument(app), {
    customSiteTitle: 'Smart Warehouse · Tài liệu API',
    swaggerOptions: {
      deepLinking: true,
      docExpansion: 'none',
      filter: true,
      defaultModelsExpandDepth: -1,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      persistAuthorization: false,
      validatorUrl: null,
    },
  });
}
