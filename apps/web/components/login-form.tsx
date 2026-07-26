"use client";

import {
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

function getSafeNextPath() {
  if (typeof window === "undefined") return "/";
  const value = new URLSearchParams(window.location.search).get("next");
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nextPath = useMemo(() => getSafeNextPath(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/public-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;

      if (!response.ok) {
        setError(result?.message ?? "登录失败，请稍后重试");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setError("无法连接登录服务，请检查网络后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <div className="login-field">
        <label htmlFor="login-username">用户名</label>
        <div className="login-input-wrap">
          <UserRound aria-hidden="true" size={19} />
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="请输入用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="login-field">
        <label htmlFor="login-password">密码</label>
        <div className="login-input-wrap">
          <LockKeyhole aria-hidden="true" size={19} />
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
          <button
            className="login-password-toggle"
            type="button"
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            onClick={() => setShowPassword((value) => !value)}
            disabled={submitting}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            <span>{showPassword ? "隐藏" : "显示密码"}</span>
          </button>
        </div>
      </div>

      <div className="login-error" role="alert" data-visible={Boolean(error)}>
        {error || "登录状态提示"}
      </div>

      <button className="login-submit" type="submit" disabled={submitting}>
        {submitting ? (
          <>
            <LoaderCircle className="spin" size={19} />
            正在登录
          </>
        ) : (
          "登录"
        )}
      </button>

      <div className="login-security-note">
        <ShieldCheck aria-hidden="true" size={17} />
        <span>安全连接 · 你的画布数据仅保存在当前电脑</span>
      </div>
    </form>
  );
}
