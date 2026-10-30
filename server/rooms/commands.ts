import type { GameModeName } from '../../src/game/physics/player';
import type { WeatherWire } from '../../src/network/protocol/messages';
import type { ServerPlayer } from '../players/ServerPlayer';
import type { WorldRoom } from './WorldRoom';

const TIMES: Record<string, number> = { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 };
const MODES: GameModeName[] = ['creative', 'survival', 'spectator'];
const WEATHER: WeatherWire[] = ['clear', 'rain', 'snow'];

const HELP = [
  'Commands:',
  '/help - show this list',
  '/players - list players in this world',
  '/spawn - return to the world spawn',
  '/time <day|noon|sunset|night|midnight|sunrise> - set the time (owner)',
  '/weather <clear|rain|snow> - set the weather (owner)',
  '/gamemode <creative|survival|spectator> [player] - change game mode (owner)',
  '/save - save the world now (owner)',
].join('\n');

/** Execute a chat command. Returns a private reply for the sender, or null. */
export function runCommand(room: WorldRoom, player: ServerPlayer, line: string): string | null {
  const [command, ...args] = line.slice(1).trim().split(/\s+/);
  const ownerOnly = () => (player.isOwner ? null : 'Only the world owner can use that command.');
  switch (command?.toLowerCase()) {
    case 'help':
    case '?':
      return HELP;
    case 'players':
      return `Players (${room.players.size}): ${[...room.players.values()].map((p) => p.name + (p.isOwner ? ' (owner)' : '')).join(', ')}`;
    case 'spawn':
      room.teleport(player, room.spawn.x, room.spawn.y, room.spawn.z);
      return 'Teleported to spawn.';
    case 'time': {
      const denied = ownerOnly();
      if (denied) return denied;
      const value = TIMES[args[0]?.toLowerCase() ?? ''];
      if (value === undefined) return 'Usage: /time <day|noon|sunset|night|midnight|sunrise>';
      room.setTime(value);
      room.systemChat(`${player.name} set the time to ${args[0].toLowerCase()}.`);
      return null;
    }
    case 'weather': {
      const denied = ownerOnly();
      if (denied) return denied;
      const weather = args[0]?.toLowerCase() as WeatherWire;
      if (!WEATHER.includes(weather)) return 'Usage: /weather <clear|rain|snow>';
      room.setWeather(weather);
      room.systemChat(`${player.name} changed the weather to ${weather}.`);
      return null;
    }
    case 'gamemode':
    case 'gm': {
      const denied = ownerOnly();
      if (denied) return denied;
      const mode = args[0]?.toLowerCase() as GameModeName;
      if (!MODES.includes(mode)) return 'Usage: /gamemode <creative|survival|spectator> [player]';
      const targetName = args.slice(1).join(' ');
      const target = targetName ? [...room.players.values()].find((p) => p.name.toLowerCase() === targetName.toLowerCase()) : player;
      if (!target) return `No player named "${targetName}" is in this world.`;
      room.setGameMode(target, mode);
      room.systemChat(`${target.name} is now in ${mode} mode.`);
      return null;
    }
    case 'save': {
      const denied = ownerOnly();
      if (denied) return denied;
      void room.save().then(() => room.systemChat('World saved.', player));
      return null;
    }
    default:
      return `Unknown command "/${command}". Type /help for a list of commands.`;
  }
}
