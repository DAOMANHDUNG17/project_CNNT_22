import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'antd/dist/reset.css';
import './styles.css';
import Application from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
dayjs.locale('vi');
createRoot(document.getElementById('root')!).render(<StrictMode><ConfigProvider locale={viVN} theme={{
  token: { colorPrimary: '#1a7a64', colorInfo: '#1a7a64', colorSuccess: '#21876a', colorText: '#203530',
    colorTextSecondary: '#788782', colorBorder: '#e1e7e4', colorBgLayout: '#f4f6f4', borderRadius: 10,
    controlHeight: 38, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  components: { Table: { headerBg: '#f7f9f7', headerColor: '#7a8781' }, Menu: { darkItemBg: 'transparent',
    darkSubMenuItemBg: 'transparent', darkItemSelectedBg: '#244b42', darkItemSelectedColor: '#d8f6e6', itemBorderRadius: 9 } },
}}><App><ErrorBoundary><BrowserRouter><AuthProvider><Application /></AuthProvider></BrowserRouter></ErrorBoundary></App></ConfigProvider></StrictMode>);
