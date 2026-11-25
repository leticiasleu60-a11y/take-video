import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
function token() { return createHmac("sha256", process.env.APP_PASSWORD || "").update("troca-take-session-v1").digest("hex"); }
export async function POST(request) {
  if (!process.env.APP_PASSWORD) return NextResponse.json({ error: "Configure APP_PASSWORD na Vercel." }, { status: 503 });
  const { password } = await request.json();
  const expected = Buffer.from(process.env.APP_PASSWORD);
  const supplied = Buffer.from(String(password || ""));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("troca_take_session", token(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 12 });
  return response;
}
