"use client";

import { useState, useEffect } from "react";

// typed wrapper around localStorage that keeps a React state value in sync with
// a persisted JSON string. returns [value, set, loaded] — identical shape to useState
// but with a third element so callers can block rendering until the stored value is read.
export function useLocalStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue); // starts as defaultValue until localStorage is read
  const [loaded, setLoaded] = useState(false); // false until the useEffect below completes

  // runs once on mount — reads the stored value and replaces the default.
  // done in useEffect (not useState initialiser) because localStorage is not available
  // during server-side rendering in Next.js; useEffect only runs in the browser.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored)); // null means key was never set — keep default
    } catch {} // JSON.parse can throw if the stored value is corrupted — silently keep default
    setLoaded(true); // signal that the read is done regardless of whether a value was found
  }, [key]);

  // replaces the state value and writes it to localStorage in one step.
  // accepts both a direct value and an updater function
  // so callers can do set(v => v + 1) without reading the current value first.
  const set = (v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {} // setItem can throw if storage is full — state still updates, persist silently fails
      return next;
    });
  };
  return [value, set, loaded] as const;
}