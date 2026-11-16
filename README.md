# Control Tower

Answer [MControlProgram](https://github.com/clarkehackworth/MControlProgram) approval requests from inside
[Hermes Desktop](https://github.com/NousResearch/hermes-agent).

When an agent's tool call is held for **ask**
(an SSH command, a URL, a proxied MCP tool), Control Tower shows it in Hermes and lets you **Allow once** or **Deny once**
without opening the MControlProgram UI.

- **Approvals page** in the sidebar: what each request is, who asked, why it asked, its arguments, and recent decisions.
- **Status-bar chip** with the number of requests waiting.
- **Desktop notification** for each new request, with Allow / Deny buttons.
- **⌘K → "Control Tower: Show MControlProgram approvals"**.

Adding allow or block *rules* still happens in MControlProgram; Control Tower only decides individual requests.

## Setup

1. **MControlProgram → Settings → Approval channel**: choose **API keys (external apps)**.
2. **MControlProgram → Settings → API keys**: create a key (e.g. `hermes-desktop`) with the **approvals** permission and
   copy it (it is shown once).
3. Install the plugin in Hermes Desktop, either way:
   - **Capabilities → Plugins → install from Git**: `https://github.com/clarkehackworth/control-tower`
   - or by hand: `mkdir -p ~/.hermes/desktop-plugins/control-tower && cp plugin.js ~/.hermes/desktop-plugins/control-tower/`
     (the app picks it up within seconds; ⌘K → *Reload desktop plugins* if not).
4. **Hermes Settings → Plugins → Control Tower**: set the MControlProgram URL (e.g. `http://127.0.0.1:7700`) and paste the key,
   then **Test connection**.

## How it works

The plugin polls `GET {url}/api/v1/approvals` every few seconds (5 by default) and posts decisions to
`POST {url}/api/v1/approvals/{id}/approved|denied`, with `Authorization: Bearer mcpk_…`. MControlProgram records the
decision as `apikey:<key name>`. The agent's blocked call wakes immediately, or picks up the decision on its next
check-back.

The key is stored in Hermes Desktop's local storage for this plugin (`hermes.plugin.control-tower.*`) and, like any desktop
plugin, readable by other plugins. Give it only the `approvals` permission, and revoke it in MControlProgram if the
machine is lost.

Prefer no plugin? MControlProgram's **MCP client prompt** channel asks Hermes directly through MCP elicitation, using
Hermes' own approval prompt. Use that when Hermes is the agent's MCP client and runs outside the agent's sandbox.

## Development

`plugin.js` is a Hermes Desktop disk plugin: plain ESM, no build step, imports only `@hermes/plugin-sdk` and
`react/jsx-runtime`. `node test.mjs` loads it with a stubbed SDK against a fake MControlProgram API.

## License

MIT
