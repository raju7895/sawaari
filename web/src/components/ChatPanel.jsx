import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import { api, fmtDateTime } from '../api';
import Avatar from './Avatar';

export default function ChatPanel({ bookingId, me, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const { subscribe, emit } = useSocket();

  useEffect(() => {
    api.get(`/api/bookings/${bookingId}/chat`).then(setMessages).catch(() => {});
    const off = subscribe('chat:message', (m) => {
      if (m.booking_id === bookingId) setMessages((cur) => [...cur, m]);
    });
    return off;
  }, [bookingId, subscribe]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    emit('chat:send', { bookingId, body }, (res) => {
      if (!res?.ok) {
        // socket path failed → REST fallback
        api.post(`/api/bookings/${bookingId}/chat`, { body }).catch(() => {});
      }
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-bold">Ride chat</p>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            Say hi — messages appear instantly for your driver.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === me.id;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar name={m.sender_name} size={28} />
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
              }`}>
                {m.body}
                <p className={`mt-0.5 text-[10px] ${mine ? 'text-brand-100' : 'text-slate-400'}`}>
                  {m.sender_name?.split(' ')[0]} · {fmtDateTime(m.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-700">
        <input
          className="input" placeholder="Type a message…" maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button onClick={send} className="btn-primary px-3" aria-label="Send"><Send className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
