import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'antd/dist/reset.css';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import './styles.css';
import Application from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyDesignVariables, warehouseTheme } from './theme';
dayjs.locale('vi');
applyDesignVariables();
createRoot(document.getElementById('root')!).render(<StrictMode><ConfigProvider locale={viVN} theme={warehouseTheme}>
  <App><ErrorBoundary><BrowserRouter><AuthProvider><Application /></AuthProvider></BrowserRouter></ErrorBoundary></App>
</ConfigProvider></StrictMode>);
