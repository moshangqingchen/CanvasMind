import type { Metadata } from "next";
import "./globals.css";
import "./studio-theme.css";
import "./canvas-studio.css";
import { MotionPreferenceBridge } from "../components/canvas-motion";
import { DesktopBridge } from "../components/desktop-bridge";

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "超级画布",
  description: "个人多模态生图/生视频工作流画布",
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
