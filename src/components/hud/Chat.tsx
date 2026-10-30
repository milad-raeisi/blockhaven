'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH } from '@/network/protocol/messages';
import { getNetworkClient } from '@/network/client/NetworkClient';
import { useGame, type ChatEntry } from '@/stores/game';

const VISIBLE_MS = 10_000;

function Message({ entry }: { entry: ChatEntry }) {
  if (entry.kind === 'system') return <div className="whitespace-pre-wrap text-amber-200">{entry.text}</div>;
  return (
    <div className="break-words">
      <span className="font-bold text-lime-300">&lt;{entry.fromName}&gt;</span> <span className="text-white">{entry.text}</span>
    </div>
  );
}

/** Recent messages overlay plus the chat input (T to open, Enter to send). */
export function Chat() {
  const { chat, panel, chatDraft, world } = useGame();
  const open = panel === 'chat';
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setText(chatDraft);
      historyIndex.current = -1;
    }
  }, [open, chatDraft]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length, open]);

  const close = () => useGame.getState().openPanel(null);

  const submit = () => {
    const message = text.trim();
    if (message && world) {
      getNetworkClient().send({ type: 'chat:send', worldId: world.id, text: message.slice(0, MAX_CHAT_LENGTH) });
      history.current = [message, ...history.current].slice(0, 20);
    }
    setText('');
    close();
  };

  const visible = open ? chat.slice(-50) : chat.filter((m) => now - m.ts < VISIBLE_MS).slice(-8);

  return (
    <div className="pointer-events-auto absolute bottom-24 left-2 w-[min(90vw,32rem)] text-sm sm:bottom-28" data-testid="chat">
      {visible.length > 0 && (
        <div ref={listRef} className={`mb-1 space-y-0.5 px-2 py-1 ${open ? 'max-h-72 overflow-y-auto bg-black/60' : 'bg-black/35'}`}>
          {visible.map((m) => (
            <Message key={m.id} entry={m} />
          ))}
        </div>
      )}
      {open && (
        <input
          autoFocus
          data-testid="chat-input"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message or /help"
          className="w-full border-2 border-black bg-black/75 px-2 py-1.5 text-white outline-none"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') close();
            else if (e.key === 'ArrowUp' && history.current.length) {
              historyIndex.current = Math.min(history.current.length - 1, historyIndex.current + 1);
              setText(history.current[historyIndex.current]);
            } else if (e.key === 'ArrowDown') {
              historyIndex.current = Math.max(-1, historyIndex.current - 1);
              setText(historyIndex.current >= 0 ? history.current[historyIndex.current] : '');
            }
          }}
        />
      )}
    </div>
  );
}
