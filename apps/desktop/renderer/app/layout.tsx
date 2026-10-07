import type { Metadata } from "next";
import "./globals.css";
import "./studio-theme.css";
import "./canvas-studio.css";
import "./canvas-workbench.css";
import { MotionPreferenceBridge } from "../components/canvas-motion";
import { DesktopBridge } from "../components/desktop-bridge";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布",
  description: "个人多模态图片、视频与音乐创作工作流画布",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><MotionPreferenceBridge />{children}<DesktopBridge /></body>
    </html>
  );
}
