# Playing on your local network

Blockhaven runs entirely on one "host" computer. Everyone else plays in a web browser. No internet connection, accounts or cloud services are needed once the project is installed.

## 1. Start the server on the host

```bash
pnpm db:up        # start PostgreSQL in Docker (once per boot)
pnpm dev          # or: pnpm build && pnpm start
```

When the server starts, it prints its addresses:

```text
  Blockhaven is running!

  On this computer:   http://localhost:3000
  On your network:    http://192.168.1.23:3000
```

The main menu also shows these addresses at the bottom of the screen.

## 2. Find the host's LAN IP address yourself (if needed)

| System | How |
|---|---|
| Windows | Open *Command Prompt* and run `ipconfig`. Use the **IPv4 Address** of your Wi-Fi or Ethernet adapter (for example `192.168.1.23`). |
| macOS | *System Settings → Wi-Fi → Details → TCP/IP*, or run `ipconfig getifaddr en0` (Wi-Fi) / `ipconfig getifaddr en1` in Terminal. |
| Linux | Run `hostname -I` or `ip -4 addr show` and use the address of your `wlan0`/`eth0` interface. |

Addresses usually look like `192.168.x.x`, `10.x.x.x` or `172.16–31.x.x`.

## 3. Join from another computer, phone or tablet

1. Connect the device to the **same Wi-Fi or Ethernet network** as the host. Guest networks often block devices from seeing each other.
2. Open a browser (Chrome, Edge, Firefox or Safari) and go to `http://HOST_LAN_IP:3000`, for example `http://192.168.1.23:3000`.
3. Choose a player name, open **Multiplayer**, and join a world from the list (or use **Join World** with a world code).

On phones and tablets, touch controls appear automatically: a joystick on the left, drag on the right half of the screen to look, and buttons for jump, place, break, crouch, items and menu. Double-tap **Jump** to fly in Creative.

## 4. Allow the server through the firewall

The host must accept incoming connections on TCP port **3000**. PostgreSQL (port 5434) is bound to `127.0.0.1` and does **not** need to be opened.

- **Windows**: the first time Node.js listens, Windows Defender Firewall asks for permission. Allow access on **Private networks**. To add a rule manually, run this in an administrator PowerShell:
  `New-NetFirewallRule -DisplayName "Blockhaven" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private`
  Make sure your network is set to **Private**, not Public.
- **macOS**: *System Settings → Network → Firewall → Options*, and allow incoming connections for `node`. If you're prompted when the server starts, click **Allow**.
- **Linux (ufw)**: `sudo ufw allow 3000/tcp`. For firewalld: `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload`.

## 5. Stopping the server

Press **Ctrl+C** in the terminal. The server saves every world and player, tells connected players it's shutting down, and exits. `pnpm db:down` stops PostgreSQL. World data stays in the Docker volume `blockhaven-pgdata`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Other devices can't open the page at all | Check that both devices are on the same network (not a guest network), that you used the host's LAN IP (not `localhost`), and that port 3000 is allowed through the firewall. Try opening `http://HOST_LAN_IP:3000/api/health` — it should show `{"status":"ok"}`. |
| The page opens but shows **Connection Failed** | A proxy or browser extension may block WebSockets. Disable VPNs and ad blockers for the page. If you access the game through a different host name or a reverse proxy, add its origin to `ALLOWED_ORIGINS` in `.env`. |
| "Your player session has expired" | The browser lost its cookie (private window closed, cookies cleared). Create the profile again. Each browser has its own player identity. |
| Stuck on "Generating terrain..." | Very old devices may not support Web Workers modules or `DecompressionStream`. Use a current Chrome, Edge, Firefox (113+) or Safari (16.4+). |
| Low frame rate | Open *Settings* and lower render distance, set graphics quality to Low and turn shadows off. Phones work best with render distance 3–4. |
| The server fails to start with a database error | Run `pnpm db:up`, wait a few seconds, then `pnpm db:migrate`. Check that `DATABASE_URL` in `.env` uses port 5434. |
| Port 3000 is already in use | Set `PORT=3001` (or another free port) in `.env` and use that port in the URLs. |
| Two players appear as the same person | They are using the same browser profile. Use a different browser, profile, or device for each player. |

## Manual LAN test with two physical devices

Use this checklist to verify a release on real hardware.

1. On the host: `pnpm db:up && pnpm db:migrate && pnpm build && pnpm start`. Note the "On your network" URL.
2. **Device A** (host browser): open `http://localhost:3000`, create the player **Player One**, then *Create World* named **Creative World** (Creative, public, showcase on). You spawn in the world.
3. **Device B** (laptop or phone on the same Wi-Fi): open `http://HOST_LAN_IP:3000`, create **Player Two**, open *Multiplayer* and confirm the world shows **1/8** players. Click *Join*.
4. Confirm both HUDs show `Players: 2` and both players see each other's character and name tag.
5. Move Player One and confirm Player Two sees smooth movement.
6. Player One places several blocks; confirm they appear for Player Two within a fraction of a second.
7. Player Two breaks one of them; confirm it disappears for Player One.
8. Build a small structure together.
9. Walk south to the mechanism showcase. Flip the **lever** at the foot of the wired staircase: the garage door rises for both players. Flip it again: it closes. Step on a **pressure plate**: the booth door opens.
10. Close the tab on Device B (or switch Wi-Fi off for 10 s). Confirm Player One sees "Player Two left the world".
11. Reopen the game on Device B and rejoin. Confirm all blocks and the door state match on both devices.
12. Press **Ctrl+C** on the host. Both clients show a shutdown/connection message.
13. Start the server again (`pnpm start`), and have both players rejoin. Confirm the structure, the mechanism state, each player's position, inventory and selected hotbar slot are restored.
