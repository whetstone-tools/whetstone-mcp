# whetstone-mcp

An [MCP](https://modelcontextprotocol.io) server for **U.S. public-records data** — so AI
agents and MCP clients (Claude Desktop, Cursor, etc.) can look up business records,
screen names against government watchlists, and pull federal awards directly.

Powered by the [Whetstone](https://whetstonetools.com/company-check/) actors on Apify. All
data is official U.S. government public-record data.

## Tools

| Tool | What it does |
|---|---|
| `business_search` | Official Secretary of State business registration (KYB) across 25 states |
| `new_business_filings` | Newly registered businesses from 10 states, windowed by date |
| `watchlist_screen` | Screen a name against 12 federal watchlists (OFAC, BIS, State Dept) |
| `federal_awards` | A company's federal contracts, grants, and loans (USAspending.gov) |

## Setup

You need a free **Apify API token** (apify.com → Settings → API & Integrations). Runs bill
to your Apify account under pay-per-result pricing (~$2 per 1,000 result rows; the free tier
covers light use).

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whetstone": {
      "command": "npx",
      "args": ["-y", "whetstone-mcp"],
      "env": { "APIFY_TOKEN": "apify_api_your_token_here" }
    }
  }
}
```

Restart Claude Desktop. The four tools then appear and the agent can call them.

### Any MCP client

Run the server over stdio:

```bash
APIFY_TOKEN=apify_api_... npx -y whetstone-mcp
```

## Notes & limits

- **Heavy queries can be slow.** Business search across all 25 states (or filings across all
  10) runs synchronously and may approach the 300-second limit. Pass a `states` subset for
  faster, cheaper runs.
- **Name-based matching.** Watchlist and federal-award results are matched by name and are
  **not identity confirmation** — verify a hit against the official source before acting.
  Nothing here is legal, compliance, or financial advice.
- A free, interactive version of the combined lookup is at
  [whetstonetools.com/company-check](https://whetstonetools.com/company-check/), and there's
  also an [n8n community node](https://www.npmjs.com/package/n8n-nodes-whetstone).

## License

[MIT](LICENSE) © Whetstone Tools · support@whetstonetools.com
