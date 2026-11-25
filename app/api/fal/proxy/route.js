import { createRouteHandler } from "@fal-ai/server-proxy/nextjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
export const runtime = "nodejs";
const handler = createRouteHandler();
async function authorized() {
  const secret = process.env.APP_PASSWORD;
  if (!secret || !process.env.FAL_KEY) return false;
  const expected = createHmac("sha256", secret).update("troca-take-session-v1").digest("hex");
  const jar = await cookies();
  const actual = jar.get("troca_take_session")?.value || "";
  const a = Buffer.from(expected), b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function guard(fn, request, context) {
  if (!await authorized()) return Response.json({ error: "Acesso não autorizado. Entre novamente." }, { status: 401 });
  return fn(request, context);
}
export const GET = (request, context) => guard(handler.GET, request, context);
export const POST = (request, context) => guard(handler.POST, request, context);
export const PUT = (request, context) => guard(handler.PUT, request, context);
