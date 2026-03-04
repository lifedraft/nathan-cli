# Nathan

A pluggable CLI that turns popular services into simple, scriptable commands. 400+ integrations out of the box via n8n's node ecosystem, with a consistent interface across all of them.

```bash
nathan github repository get --owner=torvalds --repository=linux
```

## Install

### npm / bun (recommended)

Installing as a global package pulls in nathan and all 400+ n8n integrations in one step:

```bash
# bun
bun install -g nathan-cli

# npm
npm install -g nathan-cli
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
nathan discover                 # JSON output (default)
nathan discover --human         # Formatted table
```

### 2. Describe a service

Drill down from service to resource to operation:

```bash
nathan describe github                       # What resources does GitHub have?
nathan describe github repository            # What can I do with repos?
nathan describe github repository get        # What parameters does "get" need?
```

### 3. Execute

```bash
nathan github repository get --owner=torvalds --repository=linux
nathan jsonplaceholder post list --_limit=5
nathan jsonplaceholder post create --title="Hello" --body="World" --userId=1
```

Output is JSON by default. Use `--human` for readable formatting.

## Authentication

Credentials are passed via environment variables and automatically injected into requests.

```bash
NATHAN_GITHUB_TOKEN=ghp_xxx nathan github repository get --owner=torvalds --repository=linux
```

The lookup order is: `NATHAN_<SERVICE>_TOKEN` → `<SERVICE>_TOKEN` → `NATHAN_<SERVICE>_API_KEY` → `<SERVICE>_API_KEY`.

Run `nathan describe <service>` to see which environment variables a service accepts.

## Adding Services

### YAML plugins

The simplest way to add a new service. Create a `.yaml` file in `plugins/`:

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

Nathan auto-discovers all 400+ nodes from `n8n-nodes-base` at runtime — no configuration needed.

If you installed nathan via `npm install -g` or `bun install -g`, the n8n packages are already included as dependencies. Run `nathan discover` to see all available services.

If you installed via Homebrew or binary download, install the n8n packages separately:

```bash
bun install -g n8n-nodes-base n8n-workflow
# or: npm install -g n8n-nodes-base n8n-workflow
```

You can also point to individual n8n nodes with a two-line YAML manifest in `plugins/`:

```yaml
type: n8n-compat
module: n8n-nodes-base/dist/nodes/Github/Github.node.js
```

### Plugin directories

Set `NATHAN_PLUGIN_DIRS` (colon-separated paths) to load plugins from additional directories beyond the built-in `plugins/` folder.

## Configuration

| Variable | Purpose |
|---|---|
| `NATHAN_<SERVICE>_TOKEN` | Credentials for a service |
| `NATHAN_PLUGIN_DIRS` | Additional plugin directories (colon-separated) |
| `NATHAN_DEBUG` | Enable verbose logging |

## License

MIT
