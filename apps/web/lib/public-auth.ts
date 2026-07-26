export const PUBLIC_AUTH_COOKIE = "super_canvas_session";

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function getPublicAuthConfig() {
  return {
    host: (
      process.env.SUPERCANVAS_PUBLIC_AUTH_HOST ?? "815rongai.com"
    ).toLowerCase(),
    username: process.env.SUPERCANVAS_PUBLIC_AUTH_USER ?? "",
    password: process.env.SUPERCANVAS_PUBLIC_AUTH_PASSWORD ?? "",
    sessionToken: process.env.SUPERCANVAS_PUBLIC_AUTH_SESSION_TOKEN ?? "",
  };
}

export function isPublicAuthConfigured() {
  const config = getPublicAuthConfig();
  return Boolean(config.username && config.password && config.sessionToken);
}
