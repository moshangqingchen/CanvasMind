import type { Metadata } from "next";
import "./globals.css";
import "./studio-theme.css";
import "./canvas-studio.css";
import "./theme-tokens.css";
import { MotionPreferenceBridge } from "../components/canvas-motion";
import { DesktopBridge } from "../components/desktop-bridge";
import { ThemeBridge } from "../components/theme-bridge";
import { THEME_BOOTSTRAP_SCRIPT } from "../lib/ui-preferences";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布",
  description: "个人多模态图片、视频与音乐创作工作流画布",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script id="theme-bootstrap" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head>
      <body><ThemeBridge /><MotionPreferenceBridge />{children}<DesktopBridge /></body>
    </html>
  );
}
