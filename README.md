# Blockhaven

A multiplayer voxel sandbox game that runs in the browser and is hosted on your own computer. Friends on the same Wi-Fi or Ethernet network open a URL, join a world, and build together in real time. Worlds are stored in PostgreSQL and survive restarts.

Built with **Next.js 16**, **TypeScript**, **Three.js**, native **WebSockets** (`ws`), **PostgreSQL** with **Prisma**, **Tailwind CSS**, **Zustand** and **Zod**. All textures, icons and sounds are original and generated in code.

## Features

- **Real LAN multiplayer**: a server-authoritative simulation at 20 ticks/s, client-side prediction with reconciliation, interpolated remote players with name tags, chat, automatic reconnection, and room isolation.
- **Procedural worlds** from a seed: plains, forests, deserts, snowy plains, mountains, rivers, lakes, beaches, caves and ore veins, all deterministic.
- **Fast voxel renderer**: 16×16×128 chunks meshed in Web Workers with greedy meshing, face culling, ambient occlusion, sky and block light, shadows, fog, day/night cycle, clouds, rain and snow.
- **Blocks**: natural, building, decorative and mechanical blocks, including stairs, slabs, fences, doors, trapdoors, glass, glowstone, chests and crafting tables.
- **Game modes**: Creative (searchable item palette, flying), Survival (mining time, resource drops, a data-driven 2×2/3×3 crafting system) and Spectator (fly through blocks).
- **Logic and automation**: signal wires, levers, buttons, switches, pressure plates, repeaters, inverters, AND/OR gates, timers, lamps, pistons and sticky pistons. A **mechanism showcase** (piston garage door, pressure-plate door, timed lights) can be built next to spawn in new worlds.
- **Persistence**: chunk deltas relative to generated terrain, player position, inventory, game mode, chests and world time, saved periodically, on disconnect and on shutdown, in single transactions.
- **Menus**: main menu, singleplayer, lobby with live player counts, world creation (seed, mode, terrain, visibility, password, max players, permissions, day/night, weather), join by code, settings (graphics, controls, key bindings, audio) and player profile with character colours.
- **Desktop and touch**: Pointer Lock mouse look, configurable keys, plus a virtual joystick and buttons on phones and tablets.

## Requirements

- **Node.js 20.9+** (tested with Node 24)
- **pnpm 9+** (`npm install -g pnpm` or `corepack enable`)
- **Docker** with Docker Compose for PostgreSQL. You can also use an existing PostgreSQL 14+ server and point `DATABASE_URL` at it.
- A modern browser with WebGL 2: Chrome/Edge, Firefox 113+ or Safari 16.4+. No dedicated GPU is required, and the server needs no GPU at all.

Works on Windows, macOS and Linux.

## Quick start (development)

```bash
pnpm install          # install dependencies (also generates the Prisma client)
cp .env.example .env  # Windows: copy .env.example .env  — then set SESSION_SECRET
pnpm db:up            # start PostgreSQL in Docker on 127.0.0.1:5434
pnpm db:migrate       # apply database migrations
pnpm db:seed          # optional: create a public "Showcase World"
pnpm dev              # start the game server with hot reload on http://0.0.0.0:3000
```

Open <http://localhost:3000>. Players on other devices use the "On your network" address printed in the terminal (for example `http://192.168.1.23:3000`). See **[docs/LAN.md](docs/LAN.md)** for firewall setup and troubleshooting.

## Production mode

```bash
pnpm install
pnpm db:up
pnpm db:migrate
pnpm build            # Next.js production build
pnpm start            # NODE_ENV=production; serves the game on HOST:PORT (default 0.0.0.0:3000)
```

Stop the server with **Ctrl+C**. It saves every world and disconnects players cleanly. Stop the database with `pnpm db:down`.

### Everything in Docker (optional)

```bash
docker compose --profile app up -d --build
```

This builds the app image, applies migrations and serves the game on port 3000 next to the PostgreSQL container. Set `SESSION_SECRET` in your environment or `.env` first.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server (Next.js dev + game server, restarts on server code changes) |
| `pnpm build` | Generate the Prisma client and build Next.js for production |
| `pnpm start` | Production server |
| `pnpm db:up` / `pnpm db:down` | Start / stop the PostgreSQL container |
| `pnpm db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Create a new migration after editing `prisma/schema.prisma` |
| `pnpm db:seed` | Create the demo "Showcase World" (idempotent) |
| `pnpm db:reset` | Drop and recreate the database (**deletes all worlds**) |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm test:unit` / `pnpm test:integration` | Run one suite |
| `pnpm test:e2e` | Browser tests (Playwright). Run `pnpm build` first. |
| `pnpm typecheck` | TypeScript strict type check |

## Configuration

All settings live in `.env` (see [.env.example](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://blockhaven:blockhaven@localhost:5434/blockhaven` | PostgreSQL connection |
| `TEST_DATABASE_URL` | `…/blockhaven_test` | Separate database for integration and browser tests (created automatically by Docker Compose) |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address. `0.0.0.0` makes the game reachable on the LAN |
| `SESSION_SECRET` | — | Secret for hashing session tokens. Use a long random string |
| `ALLOWED_ORIGINS` | empty | Extra origins allowed to open WebSockets (same-host origins always work) |
| `SECURE_COOKIES` | `false` | Set to `true` behind HTTPS (WebSockets then use `wss://` automatically) |
| `TICK_RATE` | `20` | Server simulation ticks per second |
| `SAVE_INTERVAL_MS` | `10000` | Auto-save interval |
| `MAX_RENDER_DISTANCE` | `12` | Largest chunk radius a client may request |
| `ROOM_IDLE_UNLOAD_SECONDS` | `60` | Unload empty worlds from memory after this long |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |

## How to play

| Control | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look around (click the game to capture the mouse) |
| **Space** | Jump; double-tap to fly in Creative (Space/Ctrl to go up/down) |
| **Shift** | Sprint |
| **Ctrl** (or **C**) | Crouch; prevents walking off edges |
| **Left click** | Break block (hold in Survival) |
| **Right click** | Place block, or use a lever, button, door, chest, crafting table, repeater… (crouch to place against them instead) |
| **Middle click** | Pick the targeted block (Creative) |
| **1–9** / mouse wheel | Select hotbar slot |
| **E** | Inventory (Creative palette or Survival crafting) |
| **T** / **/** | Chat / command |
| **Tab** | Player list |
| **F5** | Toggle first-person / third-person camera |
| **F3** | Performance overlay (FPS, frame time, draw calls, chunks, latency) |
| **Esc** | Pause menu (release the mouse) |

Key bindings can be changed in **Settings → Controls**.

**Chat commands**: `/help`, `/players`, `/spawn`. World owners can also use `/time day|night|noon|…`, `/weather clear|rain|snow`, `/gamemode creative|survival|spectator [player]` and `/save`.

**Permissions**: the world owner can give or remove building rights per player in the **Players** panel. A world's building permission can be *everyone*, *approved players* or *owner only*.

### Survival basics

Break blocks to collect them (stone drops cobblestone, coal ore drops coal…), then craft at the 2×2 grid in your inventory or at a **Crafting Table** (3×3). The recipe book in the inventory fills the grid for you. Useful recipes: log → 4 planks, 2 planks → 4 sticks, 4 planks → crafting table, iron ore + coal → iron ingot, gold ingot → 16 signal wire.

### Building circuits

- **Power sources**: lever, switch block, button (short pulse), pressure plate (while stood on) and timer (pulses on and off).
- **Signal wire** carries power up to 15 blocks and can climb one block up or down along stair-shaped paths.
- **Repeater**: input from the back, output to the front after a delay (right-click: 2/4/6/8 ticks). It also restores signal strength.
- **Inverter**: output is on while the back input is off.
- **AND / OR gates**: inputs from the left and right sides (OR also from the back), output to the front.
- **Lamps**, **doors** and **trapdoors** react to adjacent power.
- **Pistons** push up to 12 blocks. Right-click a retracted piston to set its stroke to 1, 2 or 3 blocks. **Sticky pistons** pull back the attached line of blocks of the same type.

The **mechanism showcase** south of spawn contains a piston-driven garage door: flip the lever at the foot of the wired staircase to open it (lever → OR gate → inverter → four sticky pistons with a 3-block stroke). It also has a pressure-plate entrance, a timed light, and a lever-controlled lamp post.

## Testing

```bash
pnpm db:up              # the tests use the blockhaven_test database
pnpm test               # 56 unit tests + 15 integration tests over real WebSockets and PostgreSQL
pnpm build && pnpm test:e2e   # 5 Playwright browser tests (port 3100, test database)
```

- **Unit** (`tests/unit`): seed determinism, coordinate conversion, chunk indexing, delta encoding, terrain layers and features, collision and movement physics, raycasting, inventory, crafting, signal propagation, gates, timers, pistons, the full garage-door mechanism, meshing and lighting, message validation, rate limiting, sanitizing and password hashing.
- **Integration** (`tests/integration`): starts the real server and connects real WebSocket clients. It covers two players joining, movement sync, block placement and removal, concurrent edits, room isolation, chat, malformed messages, disconnect and reconnect, world passwords, unauthenticated and foreign-origin connections, persistence across a server restart, and two players operating the garage door (including save/reload).
- **Browser** (`tests/e2e`): main menu navigation, world creation, opening the game scene, inventory interactions, movement controls, and two browser contexts joining one world, chatting and leaving.

A manual two-device LAN checklist is in [docs/LAN.md](docs/LAN.md#manual-lan-test-with-two-physical-devices).

## Project structure

```text
server/                 Node.js game server (custom HTTP server, REST API, WebSockets)
  index.ts              entry point: Next.js + game server, LAN URLs, graceful shutdown
  app.ts                HTTP server factory (/api, /ws upgrade, Next.js fallback)
  websocket/            connection handling, routing, heartbeats, rate limits
  rooms/                RoomManager (lobby, load/unload) and WorldRoom (tick loop, validation)
  world/                ServerWorld (authoritative voxels + deltas), mechanism showcase
  simulation/           circuit simulator (signals, gates, timers, pistons)
  players/              per-player state, inventory and crafting service
  persistence/          Prisma client and WorldRepository
  sessions/, security/  guest sessions, passwords, origin checks, sanitizing, rate limiting
  http/                 REST endpoints
src/
  app/                  Next.js pages (menu, lobby, worlds, game, settings, profile)
  components/           React UI: menus, lobby, HUD, inventory
  game/                 engine, renderer, chunks, blocks, terrain, physics, player, input, …
  network/              protocol (shared), browser client, clock synchronisation
  stores/               Zustand stores (settings, session, connection, game HUD)
prisma/                 schema, migrations, seed
tests/                  unit, integration, e2e
docs/                   ARCHITECTURE.md (design decisions), LAN.md (hosting guide)
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the networking model, persistence strategy, protocol and rendering pipeline.

## Known limitations

- Water is static (it does not flow), and there are no mobs, health or hunger. Survival covers mining, resource collection and crafting.
- In Survival, block drops go straight into the inventory instead of appearing as item entities.
- Very large sessions (well beyond 8–16 players) would need binary snapshots and spatial partitioning of player updates; the room architecture leaves room for both.
