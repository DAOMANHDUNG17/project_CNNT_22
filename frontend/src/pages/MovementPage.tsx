import { Button, Card, Descriptions, Result, Space, Tag, Typography } from 'antd';
import { CodeOutlined, FileTextOutlined, ToolOutlined } from '@ant-design/icons';
import { PageHeading } from '../components/Common';

// Keep this route and its existing role guard. An owns the future operational UI.
export default function MovementPage() {
  return <div className="page-enter">
    <PageHeading title="Nhập / Xuất kho" />
    <Card className="content-card handoff-card">
      <Result icon={<ToolOutlined />} title="Giao diện nhập/xuất kho đang được phát triển"
        subTitle="Module quét mã và nhập/xuất kho do thành viên An phụ trách phát triển và tích hợp với REST API đã hoàn thành của hệ thống." />
      <div className="handoff-status"><Tag color="processing">Đang phát triển Frontend</Tag><Tag>Đợi An phát triển</Tag></div>
      <Descriptions className="handoff-details" bordered column={1} items={[
        { key: 'owner', label: 'Người phụ trách', children: <Typography.Text strong>An</Typography.Text> },
        { key: 'backend', label: 'Backend', children: 'REST API đã có' },
        { key: 'docs', label: 'Tài liệu tích hợp', children: <a href="/swagger/" target="_blank" rel="noopener noreferrer">Swagger / OpenAPI</a> },
        { key: 'scanner', label: 'Giao diện quét mã', children: 'Chờ An triển khai' },
      ]} />
      <Space wrap size={12}><Button type="primary" aria-label="Mở Swagger API" href="/swagger/" target="_blank" rel="noopener noreferrer" icon={<CodeOutlined aria-hidden />}>Mở Swagger API</Button>
        <Button aria-label="Tài liệu bàn giao cho An" href="/swagger/AN_FRONTEND_HANDOFF.md" target="_blank" rel="noopener noreferrer" icon={<FileTextOutlined aria-hidden />}>Tài liệu bàn giao cho An</Button>
      </Space>
      <Typography.Paragraph className="handoff-note" style={{ marginTop: 24 }}>Các trang quản lý và lịch sử kho vẫn sử dụng dữ liệu từ hệ thống.</Typography.Paragraph>
    </Card>
  </div>;
}
