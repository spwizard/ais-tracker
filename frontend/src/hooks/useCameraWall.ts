import { useCallback, useEffect, useState } from "react";

const KEY = "ais.wall.v1";
const MAX = 9; // a 3×3 grid — fills the screen without shrinking feeds too far

/** Selection + open state for the Camera Wall, persisted to localStorage so a
 *  wall survives a reload. Capped at MAX feeds. */
export function useCameraWall() {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as string[]).slice(0, MAX) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(ids));
  }, [ids]);

  const add = useCallback(
    (id: string) => setIds((p) => (p.includes(id) || p.length >= MAX ? p : [...p, id])),
    [],
  );
  const addMany = useCallback((incoming: string[]) => {
    setIds((p) => {
      const out = [...p];
      for (const id of incoming) {
        if (out.length >= MAX) break;
        if (!out.includes(id)) out.push(id);
      }
      return out;
    });
  }, []);
  const remove = useCallback((id: string) => setIds((p) => p.filter((x) => x !== id)), []);
  const toggle = useCallback(
    (id: string) =>
      setIds((p) =>
        p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id],
      ),
    [],
  );
  const clear = useCallback(() => setIds([]), []);

  return { open, setOpen, ids, add, addMany, remove, toggle, clear, max: MAX };
}
