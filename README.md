# nathan-cli

A pluggable CLI that turns popular services into simple, scriptable commands. 400+ integrations out of the box via n8n's node ecosystem, with a consistent interface across all of them.

```bash
nathan github repository get --owner=torvalds --repository=linux
```

## Install

### npm / bun (recommended)

```bash
# bun
bun install -g nathan-cli

# npm
npm install -g nathan-cli
```

Nathan works out of the box with YAML plugins. To enable all 400+ n8n integrations, install the n8n packages globally alongside nathan:

```bash
# bun
bun install -g n8n-nodes-base n8n-workflow

# npm
npm install -g n8n-nodes-base n8n-workflow
```

### Build from source

```bash
git clone https://github.com/lifedraft/nathan.git
cd nathan
bun install
bun run build
# Output at dist/nathan
```

## How It Works

Every service follows the same pattern: **discover** what's available, **describe** it, then **execute**.

### 1. Discover services

```bash
nathan discover                 # Human-readable output (default)
nathan discover --json          # JSON output
```

### 2. Describe a service

Drill down from service to resource to operation:

```bash
nathan describe github                       # What resources does GitHub have?
nathan describe github repository            # What can I do with repos?
nathan describe github repository get        # What parameters does "get" need?
```

Each level shows progressively more detail — available resources, operations, parameters with types, required fields, and authentication info.

### 3. Execute

```bash
nathan github repository get --owner=torvalds --repository=linux
nathan jsonplaceholder post list --_limit=5
nathan jsonplaceholder post create --title="Hello" --body="World" --userId=1
```

Output is human-readable by default for `discover` and `describe`. Add `--json` for machine-readable JSON. Execution commands (`nathan <service> ...`) output JSON by default — add `--human` for formatted tables. Use `--limit=N` to truncate long result lists.

## Authentication

Credentials are passed via environment variables and automatically injected into requests.

```bash
NATHAN_GITHUB_TOKEN=ghp_xxx nathan github repository get --owner=torvalds --repository=linux
```

The lookup order is:

1. `NATHAN_<SERVICE>_TOKEN`
2. `<SERVICE>_TOKEN`
3. `NATHAN_<SERVICE>_API_KEY`
4. `<SERVICE>_API_KEY`

Run `nathan describe <service>` to see which environment variables a service accepts and whether credentials are configured.

## Adding Services

### YAML plugins

The simplest way to add a new service. Create a `.yaml` file in `~/.nathan/plugins/` or the built-in `plugins/` directory:

```yaml
name: jsonplaceholder
displayName: JSONPlaceholder
description: Free fake API for testing
version: "1.0.0"
baseURL: https://jsonplaceholder.typicode.com

resources:
  - name: post
    displayName: Post
    description: Blog posts
    operations:
      - name: list
        displayName: List Posts
        description: Get all posts
        method: GET
        path: /posts
        parameters:
          - name: _limit
            type: number
            required: false
            default: 10
            location: query    # query | path | header | body | cookie

      - name: get
        displayName: Get Post
        method: GET
        path: /posts/{id}
        parameters:
          - name: id
            type: number
            required: true
            location: path
```

### n8n nodes

Nathan auto-discovers all 400+ nodes from `n8n-nodes-base` at runtime — no configuration needed. Nodes are loaded lazily on first use, so startup stays fast.

Install `n8n-nodes-base` and `n8n-workflow` globally (see [Install](#install)) and run `nathan discover` to see all available services.

To use a custom n8n node (not part of `n8n-nodes-base`), point to it with a two-line YAML manifest in `plugins/`:

```yaml
type: n8n-compat
module: your-custom-n8n-package/dist/nodes/MyNode/MyNode.node.js
```

### Plugin directories

Nathan searches for plugins in:

1. Built-in `plugins/` directory (ships with nathan)
2. `~/.nathan/plugins/` (user plugins)

Set `NATHAN_PLUGIN_DIRS` (colon-separated paths) to load plugins from additional directories.

## Configuration

| Variable | Purpose |
|---|---|
| `NATHAN_<SERVICE>_TOKEN` | Credentials for a service |
| `NATHAN_PLUGIN_DIRS` | Additional plugin directories (colon-separated) |
| `NATHAN_DEBUG` | Enable verbose logging |
| `NATHAN_ALLOW_HTTP` | Allow HTTP URLs when credentials are present (default: HTTPS only) |

## Why "nathan"?

The name is a phonetic play on **n8n** — say "n-eight-n" fast and you get "nathan". Since this CLI gives n8n's 400+ service nodes a proper command-line interface, the name felt right.

## License

MIT
