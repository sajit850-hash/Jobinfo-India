import { API_SERVER } from "@/lib/api";

async function proxy(request: Request) {
  const incomingUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== incomingUrl.origin) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, API_SERVER);
  const headers = new Headers(request.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");
  headers.delete("origin");

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("connection");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("API proxy request failed", error);
    return Response.json({ error: "Unable to reach the API service." }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
