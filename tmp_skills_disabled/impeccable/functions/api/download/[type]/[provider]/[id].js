const VALID_ID = /^[a-zA-Z0-9_-]+$/;

const ALLOWED_PROVIDERS = [
	'cursor', 'claude-code', 'gemini', 'codex', 'agents', 'kiro',
	'universal', 'universal-prefixed',
];

const PROVIDER_CONFIG_DIRS = {
	'cursor': '.cursor',
	'claude-code': '.claude',
	'gemini': '.gemini',
	'codex': '.codex',
	'agents': '.agents',
	'kiro': '.kiro',
};

export async function onRequestGet(context) {
	const { type, provider, id } = context.params;

	if (type !== 'skill' && type !== 'command') {
		return Response.json({ error: "Invalid type" }, { status: 400 });
	}

	if (!provider || !ALLOWED_PROVIDERS.includes(provider)) {
		return Response.json({ error: "Invalid provider" }, { status: 400 });
	}

	if (!id || !VALID_ID.test(id)) {
		return Response.json({ error: "Invalid file ID" }, { status: 400 });
	}

	const configDir = PROVIDER_CONFIG_DIRS[provider];
	if (!configDir) {
		return Response.json({ error: "Invalid provider" }, { status: 400 });
	}

	const url = new URL(context.request.url);
	url.pathname = `/_data/dist/${provider}/${configDir}/skills/${id}/SKILL.md`;

	const response = await context.env.ASSETS.fetch(url);

	if (!response.ok) {
		return Response.json({ error: "File not found" }, { status: 404 });
	}

	const content = await response.arrayBuffer();

	return new Response(content, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': 'attachment; filename="SKILL.md"',
			'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
		}
	});
}
