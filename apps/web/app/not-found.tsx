import Link from "next/link";

export default function NotFound() {
  return (
    <div className="fatal-screen">
      <div className="fatal-card">
        <h1>页面不存在</h1>
        <p>这个地址没有对应的页面，回到画布继续创作吧。</p>
        <div className="fatal-actions">
          <Link className="button primary" href="/">
            回到画布
          </Link>
        </div>
      </div>
    </div>
  );
}
