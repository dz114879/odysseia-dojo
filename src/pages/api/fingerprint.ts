import type { APIRoute } from 'astro';

export const prerender = false;

export const POST = (() =>
	new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })) satisfies APIRoute;
