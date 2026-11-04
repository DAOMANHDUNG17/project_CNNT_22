import { Component } from 'react';
import type { ReactNode } from 'react';
import { Button, Result } from 'antd';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Result status="error" title="Không thể hiển thị trang" subTitle="Dữ liệu đã ghi vẫn được giữ trên máy chủ. Hãy tải lại ứng dụng."
      extra={<Button onClick={() => window.location.reload()}>Tải lại trang</Button>} /> : this.props.children;
  }
}
