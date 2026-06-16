#!/usr/bin/env node
/**
 * Whetstone MCP server — exposes U.S. public-records lookups as MCP tools so AI
 * agents (Claude Desktop, etc.) and MCP clients can call them directly.
 *
 * Each tool runs the matching Whetstone actor on Apify via
 * run-sync-get-dataset-items, authenticated with the APIFY_TOKEN env var.
 * Runs bill to the token owner's Apify account (pay-per-result).
 *
 * Configure in an MCP client, e.g.:
 *   { "command": "npx", "args": ["-y", "whetstone-mcp"],
 *     "env": { "APIFY_TOKEN": "apify_api_..." } }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const ACTORS = {
	businessSearch: 'whetstonetools~secretary-of-state-business-search',
	filings: 'whetstonetools~new-business-filings-monitor',
	watchlist: 'whetstonetools~ofac-sanctions-screen',
	awards: 'whetstonetools~federal-awards-lookup',
} as const;

/** Drop undefined/empty values so the actor uses its own defaults. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		if (typeof v === 'string' && v.trim() === '') continue;
		out[k] = v;
	}
	return out;
}

async function runActor(actorId: string, input: Record<string, unknown>): Promise<unknown> {
	const token = process.env.APIFY_TOKEN;
	if (!token) {
		throw new Error('APIFY_TOKEN environment variable is not set. Get a token at apify.com → Settings → API.');
	}
	const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=300&format=json&clean=true`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Apify HTTP ${res.status}: ${body.slice(0, 300)}`);
	}
	return res.json();
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function callAndFormat(actorId: string, input: Record<string, unknown>): Promise<ToolResult> {
	try {
		const data = await runActor(actorId, clean(input));
		const count = Array.isArray(data) ? data.length : data ? 1 : 0;
		return {
			content: [{ type: 'text', text: JSON.stringify({ count, results: data }, null, 2) }],
		};
	} catch (err) {
		return {
			content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
			isError: true,
		};
	}
}

const server = new McpServer({
	name: 'whetstone-public-records',
	version: '0.1.0',
});

server.tool(
	'business_search',
	'Look up a U.S. company\'s official Secretary of State business registration across 25 states (KYB). Returns registration records (status, dates, registered agent). Use the full or partial company name.',
	{
		companyName: z.string().describe('Business name (or part of it) to search for'),
		states: z.array(z.string()).optional().describe('Two-letter state codes to query (e.g. ["NY","TX"]). Omit for all 25 supported states.'),
		exactMatch: z.boolean().optional().describe('Only return exact name matches (case-insensitive). Default false.'),
		maxResultsPerState: z.number().int().optional().describe('Cap on records per state (1-200, default 25).'),
	},
	async (args) => callAndFormat(ACTORS.businessSearch, args),
);

server.tool(
	'new_business_filings',
	'Pull newly registered U.S. businesses from official state sources (10 states), windowed by date. Useful for sales-lead feeds and monitoring brand-new companies.',
	{
		states: z.array(z.string()).optional().describe('Two-letter state codes (e.g. ["TX","FL"]). Omit for all 10 supported states.'),
		daysBack: z.number().int().optional().describe('Return registrations from the last N days (1-90, default 7). PA lags ~1 week; use 10+ for PA.'),
		sinceDate: z.string().optional().describe('Fixed start date YYYY-MM-DD (overrides daysBack).'),
		maxResultsPerState: z.number().int().optional().describe('Cap on registrations per state (1-2000, default 100).'),
	},
	async (args) => callAndFormat(ACTORS.filings, args),
);

server.tool(
	'watchlist_screen',
	'Screen a person or business name against 12 U.S. government watchlists (OFAC SDN, BIS Entity/Denied/Unverified/MEU, State Dept Debarred/ISN, and more) via the Consolidated Screening List. Returns fuzzy-matched records. NOTE: name-based matching, NOT identity confirmation — verify any hit against the official source before acting.',
	{
		name: z.string().describe('Person or business name to screen'),
		minScore: z.number().int().optional().describe('Minimum fuzzy-match score 0-100 (default 85).'),
		includeAliases: z.boolean().optional().describe('Also match alternate names/AKAs. Default true.'),
		maxResults: z.number().int().optional().describe('Cap on matches returned (1-500, default 100).'),
		lists: z.array(z.string()).optional().describe('Restrict to source-list name substrings (e.g. ["SDN","Entity List"]). Omit for all lists.'),
	},
	async (args) => callAndFormat(ACTORS.watchlist, args),
);

server.tool(
	'federal_awards',
	'Look up a U.S. company\'s federal contracts, grants, and loans (USAspending.gov) with amounts, agencies, and dates. Useful for B2G sales intel and due diligence.',
	{
		recipientName: z.string().describe('Company or organization name to search'),
		awardTypes: z.array(z.string()).optional().describe('Categories: contracts, grants, loans, direct_payments, idvs, other_financial_assistance. Omit for all.'),
		sinceFiscalYear: z.number().int().optional().describe('Earliest federal fiscal year (>=2008). Omit for default (5 years back).'),
		maxResults: z.number().int().optional().describe('Max total award records (1-500, default 50).'),
	},
	async (args) => callAndFormat(ACTORS.awards, args),
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	// Log to stderr (stdout is the JSON-RPC channel and must stay clean).
	process.stderr.write('whetstone-mcp server running on stdio\n');
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${(err as Error).message}\n`);
	process.exit(1);
});
