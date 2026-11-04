import type { ThemeConfig } from 'antd';

// SMART WAREHOUSE — RED ENTERPRISE DESIGN SYSTEM
export const colors = {
  primary: '#B42332', primaryHover: '#CC3342', primaryActive: '#8F1724',
  sidebar: '#831C28', sidebarDark: '#661520', tint: '#FFF1F2', background: '#F6F7F9', surface: '#FFFFFF',
  heading: '#20242D', text: '#344054', secondary: '#667085', border: '#E5E7EB',
  success: '#16866C', warning: '#D99A20', error: '#D92D20',
};
export const fontFamily = '"Be Vietnam Pro", Inter, Arial, sans-serif';
export function applyDesignVariables() {
  for (const [name, value] of Object.entries(colors)) {
    document.documentElement.style.setProperty(`--sw-${name}`, value);
  }
}
export const warehouseTheme: ThemeConfig = {
  token: {
    colorPrimary: colors.primary, colorPrimaryHover: colors.primaryHover,
    colorPrimaryActive: colors.primaryActive, colorInfo: colors.primary,
    colorSuccess: colors.success, colorWarning: colors.warning, colorError: colors.error,
    colorText: colors.text, colorTextHeading: colors.heading, colorTextSecondary: colors.secondary, colorBorder: colors.border,
    colorBgLayout: colors.background, colorBgContainer: colors.surface,
    fontFamily, fontSize: 14, borderRadius: 9, borderRadiusLG: 16,
    controlHeight: 42, controlHeightLG: 46, controlHeightSM: 32,
    boxShadowSecondary: '0 12px 40px rgba(16, 24, 40, 0.09)',
  },
  components: {
    Layout: { bodyBg: colors.background, headerBg: colors.surface, siderBg: colors.surface },
    Card: { paddingLG: 24, headerFontSize: 16 },
    Button: { fontWeight: 600, primaryShadow: '0 3px 8px rgba(16, 24, 40, 0.08)' },
    Input: { paddingInline: 12, activeShadow: '0 0 0 3px rgba(16, 24, 40, 0.04)' },
    Table: { headerBg: '#F8F9FB', headerColor: colors.secondary, headerSplitColor: 'transparent',
      rowHoverBg: '#FFFAFA', borderColor: '#EEF0F3', cellPaddingBlockMD: 16, cellPaddingInlineMD: 16 },
    Menu: { itemBg: colors.surface, itemColor: colors.secondary,
      itemHoverBg: colors.background, itemHoverColor: colors.text,
      itemSelectedBg: '#F0F0F1', itemSelectedColor: colors.primary,
      activeBarWidth: 0, itemBorderRadius: 8, itemHeight: 44, iconSize: 18 },
    Tag: { borderRadiusSM: 6 },
    Modal: { titleFontSize: 20 },
    Drawer: { footerPaddingBlock: 20, footerPaddingInline: 24 },
    Descriptions: { labelBg: '#F8F9FB', itemPaddingBottom: 16 },
    Tabs: { titleFontSize: 14, horizontalItemGutter: 28 },
    Segmented: { trackBg: '#F2F4F7', itemSelectedColor: colors.primary },
  },
};
