import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../api';
import { apiBase } from '../serverConfig';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, loading } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(new Map());
  const socketRef = useRef(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !getToken()) { setSocket(null); return; }

    const s = io(apiBase() || window.location.origin, {
      path: '/socket.io',
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = s;
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));

    return () => { s.close(); setSocket(null); setConnected(false); };
  }, [user?.id, loading]);

  /** subscribe(event, handler) → unsubscribe fn */
  const subscribe = (event, handler) => {
    const s = socketRef.current;
    if (!s) return () => {};
    s.on(event, handler);
    return () => s.off(event, handler);
  };
  const emit = (...args) => socketRef.current?.emit(...args);

  return (
    <SocketContext.Provider value={{ socket, connected, subscribe, emit }}>
      {children}
    </SocketContext.Provider>
  );
}
export const useSocket = () => useContext(SocketContext);
