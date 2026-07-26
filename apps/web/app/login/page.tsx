import type { Metadata } from "next";
import { LoginForm } from "../../components/login-form";

export const metadata: Metadata = {
  title: "登录 · 超级画布",
  description: "登录超级画布工作台",
};

function BrandMark() {
  return (
    <span className="login-brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function WorkflowArtwork() {
  return (
    <div className="login-workflow" aria-hidden="true">
      <svg viewBox="0 0 760 560" role="presentation">
        <defs>
          <linearGradient id="login-edge" x1="0" x2="1">
            <stop offset="0" stopColor="#554bb7" stopOpacity="0.25" />
            <stop offset="0.5" stopColor="#8f81f5" stopOpacity="0.8" />
            <stop offset="1" stopColor="#5de2c2" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="login-node" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#232742" />
            <stop offset="1" stopColor="#121722" />
          </linearGradient>
        </defs>
        <g className="login-workflow-edges">
          <path d="M40 125 C140 125 130 180 245 180" />
          <path d="M40 300 C150 300 160 292 255 292" />
          <path d="M135 470 C210 470 190 365 275 347" />
          <path d="M385 292 C485 292 475 222 570 222" />
          <path d="M385 292 C490 292 495 370 600 370" />
          <path d="M360 347 C430 420 470 472 560 472" />
          <path d="M338 180 C445 180 448 120 560 120" />
        </g>
        <g className="login-workflow-node login-workflow-node-main">
          <rect x="255" y="232" width="132" height="120" rx="18" />
          <circle cx="255" cy="292" r="6" />
          <circle cx="387" cy="292" r="6" />
          <path d="M321 264 329 283 348 291 329 299 321 318 313 299 294 291 313 283Z" />
          <path d="m347 270 4 9 9 4-9 4-4 9-4-9-9-4 9-4Z" />
        </g>
        <g className="login-workflow-node">
          <rect x="38" y="88" width="100" height="75" rx="13" />
          <path d="M77 108h23M88.5 108v35M77 143h23" />
          <circle cx="138" cy="125" r="5" />
        </g>
        <g className="login-workflow-node login-workflow-node-accent">
          <rect x="245" y="140" width="94" height="79" rx="13" />
          <path d="m264 199 18-19 13 13 8-8 17 14M267 161h51v40h-51z" />
          <circle cx="279" cy="174" r="4" />
        </g>
        <g className="login-workflow-node">
          <rect x="560" y="86" width="98" height="71" rx="13" />
          <path d="m609 107 18 10v21l-18 10-18-10v-21zM591 117l18 10 18-10M609 127v21" />
        </g>
        <g className="login-workflow-node">
          <rect x="570" y="186" width="105" height="72" rx="13" />
          <path d="m608 204 27 18-27 18z" />
        </g>
        <g className="login-workflow-node">
          <rect x="600" y="334" width="105" height="72" rx="13" />
          <path d="m635 353 13 13-13 13M671 353l-13 13 13 13" />
        </g>
        <g className="login-workflow-node">
          <rect x="92" y="438" width="104" height="72" rx="13" />
          <path d="m124 458-13 16 13 16M164 458l13 16-13 16M151 451l-14 46" />
        </g>
        <g className="login-workflow-node">
          <rect x="560" y="438" width="105" height="72" rx="13" />
          <path d="M585 477h8M601 465v24M609 458v38M617 468v18M625 461v32M633 471v12M641 465v24" />
        </g>
      </svg>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow login-glow-one" aria-hidden="true" />
      <div className="login-glow login-glow-two" aria-hidden="true" />

      <header className="login-brand">
        <BrandMark />
        <strong>超级画布</strong>
      </header>

      <WorkflowArtwork />

      <section className="login-card-wrap" aria-label="登录超级画布">
        <div className="login-card">
          <div className="login-card-heading">
            <span className="login-card-kicker">SUPER CANVAS</span>
            <h1>欢迎回来</h1>
            <p>登录超级画布，继续你的创作</p>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
