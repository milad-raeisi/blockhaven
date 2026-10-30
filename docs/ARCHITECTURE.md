# Blockhaven architecture

This document explains how the pieces fit together and records the main design decisions.

## Overview

```text
Browser (Next.js pages + React HUD)
 └─ Game engine (src/game/engine/Game.ts, plain TypeScript + Three.js)
     ├─ InputManager ── keyboard, Pointer Lock, touch
     ├─ LocalPlayer ─── client-side prediction + reconciliation (shared physics)
     ├─ ChunkManager ── chunk streaming, Web Worker terrain + meshing
     ├─ RemotePlayers ─ snapshot interpolation
     ├─ Renderer ────── Three.js scene, materials, sky, weather
     └─ NetworkClient ─ WebSocket (/ws), reconnects automatically
            │  JSON protocol, Zod-validated on the server
Node.js process (server/index.ts)
 ├─ HTTP server ─── /api/* (REST), everything else → Next.js request handler
 ├─ upgrade /ws ─── WebSocketGateway (ws) → RoomManager → WorldRoom
 │                  other upgrades (Next.js HMR) → Next.js upgrade handler
 └─ WorldRoom (one per loaded world, fixed 20 TPS loop)
     ├─ ServerWorld ─────── authoritative voxels = generated terrain + deltas
     ├─ CircuitSimulator ── signals, gates, timers, pistons
     ├─ InventoryService ── validated inventory / crafting / chests
     └─ WorldRepository ─── Prisma → PostgreSQL (batched, transactional saves)
```

### Directory layout

| Path | Contents | Runs on |
|---|---|---|
| `src/game/blocks`, `terrain`, `chunks/chunk.ts`, `chunks/delta.ts`, `physics`, `world`, `items`, `inventory`, `crafting`, `lighting` | Shared, DOM-free game definitions | Browser **and** server |
| `src/network/protocol` | Message types and Zod schemas | Browser and server |
| `src/game/renderer`, `engine`, `player`, `input`, `audio`, `workers`, `chunks/ChunkManager.ts`, `chunks/mesher.ts` | Client engine | Browser |
| `src/app`, `src/components`, `src/stores`, `src/hooks` | Next.js pages, React UI, Zustand stores | Browser |
| `server/` | Authoritative game server, REST API, persistence | Node.js only |
| `prisma/` | Schema, migrations, seed | Node.js only |

Server-only packages (`@prisma/client`, `ws`) are aliased to `false` in the browser webpack config, so an accidental import fails the build rather than leaking into the bundle.

## Decisions

### ADR-1: One Node.js process serves Next.js, REST and WebSockets
A custom HTTP server (`server/app.ts`) owns the port. `/api/*` is handled by a small router in the same process, `/ws` upgrades go to the `ws` server, and everything else goes to Next.js. This keeps the game server alive as long as the process runs (no serverless instances), lets REST endpoints read live room state (player counts) directly, and serves HTTP and WebSocket traffic on the same host and port. Next.js runs in webpack mode because the chunk Web Worker uses `new Worker(new URL(...))`.

### ADR-2: Deterministic terrain + sparse deltas
Terrain is a pure function of the seed and coordinates (integer hashing plus simplex noise that only uses `+`, `*` and `Math.floor`, so it is bit-identical in every JavaScript engine). Clients generate base terrain themselves in a Web Worker. The server stores and sends only the modifications: per chunk, a map of `index → (block, meta)`, encoded as `u32 count + n × (u16 index, u8 block, u8 meta)` and deflate-compressed in `WorldChunk.data`. Each chunk has a revision number. Clients send the revision they already have, and unchanged chunks are answered with a tiny `unchanged` message (which is how reconnects resync cheaply).

### ADR-3: Server-authoritative movement with prediction
Players simulate their own movement with the shared physics (`src/game/physics/player.ts`) at a fixed 20 Hz and send every input with a sequence number. The server simulates the same inputs (rate-limited by a token bucket, so speed hacks don't work), then returns `player:state` with the last processed sequence. The client replays unacknowledged inputs on top of that state and smooths small corrections. Rendering interpolates between physics steps, so movement stays smooth at any frame rate. Remote players are rendered about 110 ms in the past, interpolating between snapshots.

### ADR-4: Optimistic block edits with server corrections
Block edits are applied locally right away. The server validates permission, game mode, reach, support rules, player collision and Survival break time. It broadcasts accepted changes (`block:update`) to clients subscribed to that chunk. A rejected edit returns `block:action-result` with the authoritative block values, which roll back the prediction. Concurrent edits of one cell are resolved by arrival order in the single-threaded room loop, so exactly one wins and the other client gets a correction.

### ADR-5: Interest management
Each player has a set of subscribed chunks (those it requested within its render distance). Block and circuit updates go only to subscribers, and player snapshots include only players within render distance. The server fully generates only chunks near players (simulation radius 2); other chunks keep only their delta in memory.

### ADR-6: Circuits use a deterministic event queue
`CircuitSimulator` re-evaluates dirty positions each tick. Wire networks are solved instantly (strength 15, −1 per wire, including diagonal steps). Repeaters, gates and pistons change through a tick-ordered queue, which breaks feedback loops into discrete steps. Per-tick budgets and a burnout guard (more than 24 toggles per second disables a position for 5 s) bound server load. Circuit state lives in block metadata, so it persists and syncs like any other block. When a chunk loads, its components are re-evaluated, which restores timers and pending changes after a restart.

Pistons have a configurable stroke of 1–3 blocks (right-click to cycle). Sticky pistons pull back the contiguous line of blocks of the same type as the first attached block. This is what lets the garage door move a 3-block-tall iron panel in one motion.

### ADR-7: Persistence strategy
Every room saves every `SAVE_INTERVAL_MS` (10 s), on owner request (`/save`), when a player leaves, when an idle room unloads and on graceful shutdown (SIGINT/SIGTERM). A save writes dirty chunks, the world clock, dirty player states and inventories, and chest contents in **one transaction**, so a crash can never leave, for example, a placed block without the matching inventory change. If a save fails, the dirty markers are restored and the next save retries.

### ADR-8: Guest identity
`POST /api/session` creates a player and sets a random 256-bit token in an `HttpOnly; SameSite=Lax` cookie. Only an HMAC-SHA256 of the token (keyed with `SESSION_SECRET`) is stored. WebSocket upgrades are authenticated from the same cookie and must come from a same-host origin (or one listed in `ALLOWED_ORIGINS`). Player ids sent by clients are never trusted; the server always uses the session's player.

## Network protocol (v1)

All messages are JSON objects with a `type`. Client → server messages are validated with Zod (`src/network/protocol/messages.ts`), size-limited (16 KiB) and rate-limited per category. World-scoped messages carry `worldId` and are rejected if it does not match the connection's current room.

| Direction | Types |
|---|---|
| client → server | `connection:hello`, `connection:ping`, `lobby:subscribe`, `lobby:unsubscribe`, `world:join`, `world:leave`, `world:chunk-request`, `world:chunk-release`, `world:render-distance`, `player:input`, `block:mine-start`, `block:break`, `block:place`, `block:interact`, `inventory:select`, `inventory:move`, `inventory:creative-set`, `inventory:close`, `crafting:take`, `chat:send`, `world:save`, `world:set-permission` |
| server → client | `connection:welcome`, `connection:error`, `connection:pong`, `lobby:worlds`, `world:metadata`, `world:left`, `world:chunk-data`, `world:time-update`, `player:join`, `player:update`, `player:leave`, `player:snapshot`, `player:state`, `block:update`, `circuit:state-update`, `block:action-result`, `inventory:update`, `inventory:open`, `chat:message`, `server:notification`, `server:shutdown` |

## Rendering

- **Chunk meshes** are built in Web Workers (up to 4). Full cubes use greedy meshing per face direction; faces merge only when texture, ambient occlusion and light match. Other shapes (slabs, stairs, doors, wires, gates, piston arms…) are emitted as boxes. There are three layers per chunk: opaque, alpha-tested cutout (leaves, glass, plants) and translucent (water), which means at most three draw calls per chunk.
- **Lighting**: sky light and block light (glowstone, lit lamps) are propagated over a 3×3 chunk neighbourhood with a BFS and stored per vertex. A patched `MeshLambertMaterial` combines them with the day/night factor and ambient occlusion, while the directional sun casts shadows.
- **Textures** are original 16×16 pixel art painted procedurally into one atlas (`src/game/renderer/textures.ts`) with nearest filtering. Inventory icons are rendered from the same atlas.
- Meshes are frustum-culled by Three.js. Geometries are disposed when chunks unload or re-mesh. A block edit re-meshes only the affected chunk, plus neighbours when the edit is on a border or changes light.
